import json
import logging
from typing import AsyncGenerator, Optional, Dict, Any, List

import httpx
from sqlalchemy import select as sa_select, func as sa_func, delete as sa_delete
from app.database import async_session
from app.models.rag import RagConfig, RagChatSession, RagChatMessage
from app.services.rag.embedding_service import EmbeddingService
from app.services.rag.search_engine import SearchEngine, SearchResult
from app.services.rag.indexer import Indexer
from app.services import ollama_lock

logger = logging.getLogger(__name__)


class RAGService:
    """Orchestrates RAG chat: retrieves context, generates answers with source attribution."""

    def __init__(self):
        self.search_engine = SearchEngine()
        self.indexer = Indexer(self.search_engine)
        self._initialized = False

    async def initialize(self):
        if self._initialized:
            return
        self.search_engine.init_chroma()
        self.search_engine.load_bm25_index()
        self._initialized = True
        logger.info("RAG service initialized")

    async def _get_config(self) -> RagConfig:
        async with async_session() as db:
            result = await db.execute(sa_select(RagConfig).where(RagConfig.id == 1))
            config = result.scalar_one_or_none()
            if not config:
                config = RagConfig(id=1)
                db.add(config)
                await db.commit()
                await db.refresh(config)
            return config

    async def _get_embedding_service(self, config: RagConfig) -> EmbeddingService:
        return EmbeddingService(
            provider=config.embedding_provider,
            model=config.embedding_model,
            ollama_base_url=config.ollama_base_url,
        )

    async def search(
        self,
        query: str,
        limit: int = 5,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[SearchResult]:
        await self.initialize()
        config = await self._get_config()

        embed_service = await self._get_embedding_service(config)
        query_embeddings = await embed_service.generate([query])
        if not query_embeddings or not query_embeddings[0]:
            return []

        results = await self.search_engine.hybrid_search(
            query=query,
            query_embedding=query_embeddings[0],
            limit=limit,
            filters=filters,
        )
        return results

    async def chat_stream(
        self,
        question: str,
        session_id: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[str, None]:
        await self.initialize()
        config = await self._get_config()

        # Get or create session
        async with async_session() as db:
            if session_id:
                result = await db.execute(
                    sa_select(RagChatSession).where(RagChatSession.id == session_id)
                )
                session = result.scalar_one_or_none()
                if not session:
                    session = RagChatSession(id=session_id)
                    db.add(session)
                    await db.commit()
            else:
                import uuid
                session_id = str(uuid.uuid4())
                session = RagChatSession(id=session_id, title=question[:100])
                db.add(session)
                await db.commit()

            # Save user message
            user_msg = RagChatMessage(session_id=session_id, role="user", content=question)
            db.add(user_msg)
            await db.commit()

        # Retrieve relevant documents (fetch extra, then apply score cutoff)
        fetch_limit = config.max_sources + 3
        raw_results = await self.search(question, limit=fetch_limit, filters=filters)

        # Score cutoff: drop results below 40% of the top score
        if raw_results:
            top_score = raw_results[0].score
            cutoff = top_score * 0.40
            search_results = [r for r in raw_results if r.score >= cutoff][:config.max_sources]
        else:
            search_results = []

        context_parts = []
        sources = []
        for i, result in enumerate(search_results):
            context_parts.append(
                f"[Quelle {i+1}: {result.title} (Dokument #{result.document_id})]\n{result.snippet}\n"
            )
            sources.append({
                "index": i + 1,
                "document_id": result.document_id,
                "title": result.title,
                "score": result.score,
                "snippet": result.snippet[:200],
            })
        context = "\n---\n".join(context_parts)

        # Load recent chat history for context
        chat_history = []
        async with async_session() as db:
            result = await db.execute(
                sa_select(RagChatMessage)
                .where(RagChatMessage.session_id == session_id)
                .order_by(RagChatMessage.created_at.desc())
                .limit(10)
            )
            history_msgs = list(reversed(result.scalars().all()))
            for msg in history_msgs[:-1]:  # exclude current user message
                chat_history.append({"role": msg.role, "content": msg.content})

        # Build prompt
        system_prompt = config.chat_system_prompt or (
            "Du bist ein hilfreicher Assistent der Fragen zu Dokumenten beantwortet. "
            "Antworte basierend auf dem bereitgestellten Kontext."
        )

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(chat_history)

        user_content = question
        if context:
            user_content = (
                f"Kontext aus den Dokumenten:\n\n{context}\n\n---\n\nFrage: {question}\n\n"
                f"Beantworte die Frage basierend auf dem Kontext. "
                f"Zitiere die verwendeten Quellen mit [1], [2] usw. direkt in deiner Antwort."
            )
        messages.append({"role": "user", "content": user_content})

        # Yield session info first
        yield json.dumps({"type": "session", "session_id": session_id})

        # Yield sources
        yield json.dumps({"type": "sources", "sources": sources})

        # Signal that LLM is generating (show lock state if busy)
        if ollama_lock.is_locked() and ollama_lock.current_holder() != "rag_chat":
            yield json.dumps({"type": "status", "message": f"Warte auf Ollama (läuft: {ollama_lock.current_holder()})..."})
        else:
            yield json.dumps({"type": "status", "message": "Generiere Antwort..."})

        # Stream LLM response
        import re as _re
        full_response = ""
        async for token in self._stream_llm(config, messages):
            full_response += token
            yield json.dumps({"type": "token", "content": token})

        # Extract cited source indices from the response (e.g. [1], [2])
        cited_indices = sorted(set(
            int(m) for m in _re.findall(r'\[(\d+)\]', full_response)
            if 1 <= int(m) <= len(sources)
        ))
        yield json.dumps({"type": "citations", "cited": cited_indices})

        # Save assistant message
        async with async_session() as db:
            assistant_msg = RagChatMessage(
                session_id=session_id,
                role="assistant",
                content=full_response,
                sources=json.dumps(sources),
            )
            db.add(assistant_msg)
            await db.commit()

        yield json.dumps({"type": "done"})

    async def _stream_llm(self, config: RagConfig, messages: list) -> AsyncGenerator[str, None]:
        if config.chat_model_provider == "ollama":
            async for token in self._stream_ollama(config, messages):
                yield token
        elif config.chat_model_provider == "openai":
            async for token in self._stream_openai(config, messages):
                yield token
        else:
            async for token in self._stream_ollama(config, messages):
                yield token

    async def _stream_ollama(self, config: RagConfig, messages: list) -> AsyncGenerator[str, None]:
        import asyncio
        url = f"{config.ollama_base_url}/api/chat"
        payload = {
            "model": config.chat_model,
            "messages": messages,
            "stream": True,
            "think": False,
        }

        acquired = await ollama_lock.acquire("rag_chat", timeout=120)
        if not acquired:
            logger.warning("RAG chat: OllamaLock timeout – Classifier läuft noch, bitte erneut versuchen")
            yield "\n\n[Ollama ist gerade belegt (Klassifizierung läuft). Bitte in 30 Sekunden erneut versuchen.]"
            return

        try:
            for attempt in range(3):
                try:
                    if attempt > 0:
                        logger.info(f"Ollama chat retry {attempt+1}/3 for {config.chat_model}")
                        await asyncio.sleep(3)

                    async with httpx.AsyncClient(timeout=300.0) as client:
                        async with client.stream("POST", url, json=payload) as resp:
                            resp.raise_for_status()
                            async for line in resp.aiter_lines():
                                if line.strip():
                                    try:
                                        data = json.loads(line)
                                        content = data.get("message", {}).get("content", "")
                                        if content:
                                            yield content
                                        if data.get("done"):
                                            break
                                    except json.JSONDecodeError:
                                        continue
                    return
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 500 and attempt < 2:
                        logger.warning(f"Ollama 500 error (attempt {attempt+1}), retrying after model swap...")
                        continue
                    logger.error(f"Ollama streaming error: {e}")
                    yield f"\n\n[Fehler: Ollama-Modell '{config.chat_model}' konnte nicht geladen werden. Bitte versuche es erneut.]"
                    return
                except Exception as e:
                    logger.error(f"Ollama streaming error: {e}")
                    yield f"\n\n[Fehler: {e}]"
                    return
        finally:
            ollama_lock.release("rag_chat")

    async def _stream_openai(self, config: RagConfig, messages: list) -> AsyncGenerator[str, None]:
        try:
            from openai import AsyncOpenAI
            # Get OpenAI API key from LLM providers table
            from app.models import LLMProvider
            async with async_session() as db:
                result = await db.execute(
                    sa_select(LLMProvider).where(LLMProvider.name == "openai")
                )
                provider = result.scalar_one_or_none()
                api_key = provider.api_key if provider else ""

            client = AsyncOpenAI(api_key=api_key)
            stream = await client.chat.completions.create(
                model=config.chat_model or "gpt-4o-mini",
                messages=messages,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    yield delta.content
        except Exception as e:
            logger.error(f"OpenAI streaming error: {e}")
            yield f"\n\n[Fehler: {e}]"

    # Session management
    async def get_sessions(self) -> list:
        async with async_session() as db:
            result = await db.execute(
                sa_select(RagChatSession).order_by(RagChatSession.updated_at.desc())
            )
            sessions = result.scalars().all()
            out = []
            for s in sessions:
                count_result = await db.execute(
                    sa_select(sa_func.count(RagChatMessage.id))
                    .where(RagChatMessage.session_id == s.id)
                )
                msg_count = count_result.scalar() or 0
                out.append({
                    "id": s.id,
                    "title": s.title,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                    "updated_at": s.updated_at.isoformat() if s.updated_at else None,
                    "message_count": msg_count,
                })
            return out

    async def get_session(self, session_id: str) -> Optional[dict]:
        async with async_session() as db:
            result = await db.execute(
                sa_select(RagChatSession).where(RagChatSession.id == session_id)
            )
            session = result.scalar_one_or_none()
            if not session:
                return None

            msg_result = await db.execute(
                sa_select(RagChatMessage)
                .where(RagChatMessage.session_id == session_id)
                .order_by(RagChatMessage.created_at.asc())
            )
            messages = msg_result.scalars().all()
            return {
                "id": session.id,
                "title": session.title,
                "created_at": session.created_at.isoformat() if session.created_at else None,
                "messages": [
                    {
                        "id": m.id,
                        "role": m.role,
                        "content": m.content,
                        "sources": json.loads(m.sources) if m.sources else [],
                        "created_at": m.created_at.isoformat() if m.created_at else None,
                    }
                    for m in messages
                ],
            }

    async def delete_session(self, session_id: str) -> bool:
        async with async_session() as db:
            await db.execute(
                sa_delete(RagChatMessage).where(RagChatMessage.session_id == session_id)
            )
            result = await db.execute(
                sa_delete(RagChatSession).where(RagChatSession.id == session_id)
            )
            await db.commit()
            return result.rowcount > 0

    async def get_config_dict(self) -> dict:
        config = await self._get_config()
        return {
            "embedding_provider": config.embedding_provider,
            "embedding_model": config.embedding_model,
            "ollama_base_url": config.ollama_base_url,
            "chunk_size": config.chunk_size,
            "chunk_overlap": config.chunk_overlap,
            "bm25_weight": config.bm25_weight,
            "semantic_weight": config.semantic_weight,
            "max_sources": config.max_sources,
            "max_context_tokens": config.max_context_tokens,
            "chat_model_provider": config.chat_model_provider,
            "chat_model": config.chat_model,
            "chat_system_prompt": config.chat_system_prompt,
            "auto_index_enabled": config.auto_index_enabled,
            "auto_index_interval": config.auto_index_interval,
        }

    async def update_config(self, updates: dict) -> dict:
        async with async_session() as db:
            result = await db.execute(sa_select(RagConfig).where(RagConfig.id == 1))
            config = result.scalar_one_or_none()
            if not config:
                config = RagConfig(id=1)
                db.add(config)

            allowed = {
                "embedding_provider", "embedding_model", "ollama_base_url",
                "chunk_size", "chunk_overlap", "bm25_weight", "semantic_weight",
                "max_sources", "max_context_tokens", "chat_model_provider",
                "chat_model", "chat_system_prompt", "auto_index_enabled",
                "auto_index_interval",
            }
            for key, value in updates.items():
                if key in allowed and hasattr(config, key):
                    setattr(config, key, value)

            await db.commit()

        return await self.get_config_dict()
