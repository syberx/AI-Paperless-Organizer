import asyncio
import json
import logging
from datetime import datetime
from typing import Optional, Set

from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.rag import RagConfig, RagIndexingState
from app.services.rag.embedding_service import EmbeddingService
from app.services.rag.chunking import ChunkingService
from app.services.rag.search_engine import SearchEngine

logger = logging.getLogger(__name__)


class Indexer:
    """Manages document indexing: fetches from Paperless, chunks, embeds, stores."""

    def __init__(self, search_engine: SearchEngine):
        self.search_engine = search_engine
        self._indexing_task: Optional[asyncio.Task] = None

    async def _get_config(self, db: AsyncSession) -> Optional[RagConfig]:
        result = await db.execute(sa_select(RagConfig).where(RagConfig.id == 1))
        return result.scalar_one_or_none()

    async def _get_or_create_state(self, db: AsyncSession) -> RagIndexingState:
        result = await db.execute(sa_select(RagIndexingState).where(RagIndexingState.id == 1))
        state = result.scalar_one_or_none()
        if not state:
            state = RagIndexingState(id=1)
            db.add(state)
            await db.commit()
            await db.refresh(state)
        return state

    async def _get_paperless_client(self):
        from app.models import PaperlessSettings
        from app.services.paperless_client import PaperlessClient
        async with async_session() as db:
            result = await db.execute(sa_select(PaperlessSettings).where(PaperlessSettings.id == 1))
            settings = result.scalar_one_or_none()
            if not settings or not settings.is_configured:
                raise ValueError("Paperless-ngx ist nicht konfiguriert")
            return PaperlessClient(base_url=settings.url, api_token=settings.api_token)

    async def start_indexing(self, force: bool = False):
        if self._indexing_task and not self._indexing_task.done():
            logger.warning("Indexing already in progress")
            return

        async with async_session() as db:
            state = await self._get_or_create_state(db)
            if state.status == "indexing":
                logger.warning("Resetting stale 'indexing' status from previous run")
                state.status = "idle"
                await db.commit()

        self._indexing_task = asyncio.create_task(self._index_all(force))

    async def _index_all(self, force: bool = False):
        async with async_session() as db:
            state = await self._get_or_create_state(db)
            config = await self._get_config(db)

            if not config:
                config = RagConfig(id=1)
                db.add(config)
                await db.commit()
                await db.refresh(config)

            state.status = "indexing"
            state.error_message = ""
            await db.commit()

        try:
            client = await self._get_paperless_client()
            self.search_engine.init_chroma()

            already_indexed: Set[int] = set()
            if not force:
                async with async_session() as db:
                    state = await self._get_or_create_state(db)
                    try:
                        already_indexed = set(json.loads(state.indexed_doc_ids or "[]"))
                    except (json.JSONDecodeError, TypeError):
                        already_indexed = set()

            documents = await self._fetch_all_documents(client)
            total = len(documents)

            if not force:
                documents = [d for d in documents if d["id"] not in already_indexed]

            if not documents and not force:
                async with async_session() as db:
                    state = await self._get_or_create_state(db)
                    state.status = "completed"
                    state.total_documents = total
                    await db.commit()
                logger.info("No new documents to index")
                return

            if force:
                already_indexed = set()

            async with async_session() as db:
                state = await self._get_or_create_state(db)
                state.total_documents = total
                state.indexed_documents = len(already_indexed)
                await db.commit()

            embedding_service = EmbeddingService(
                provider=config.embedding_provider,
                model=config.embedding_model,
                ollama_base_url=config.ollama_base_url,
            )
            chunking_service = ChunkingService(
                chunk_size=config.chunk_size,
                chunk_overlap=config.chunk_overlap,
            )

            batch_size = 50
            for i in range(0, len(documents), batch_size):
                batch = documents[i:i + batch_size]
                chunk_count = 0
                try:
                    all_chunks = chunking_service.chunk_documents(batch)
                    chunk_count = len(all_chunks)

                    if all_chunks:
                        texts = [c["text"] for c in all_chunks]
                        embeddings = await embedding_service.generate(texts)
                        self.search_engine.add_chunks(all_chunks, embeddings, rebuild_bm25=False)

                    for doc in batch:
                        already_indexed.add(doc["id"])

                except Exception as e:
                    logger.error(f"Error indexing batch {i}-{i+batch_size}: {e}", exc_info=True)
                    for doc in batch:
                        already_indexed.add(doc["id"])

                async with async_session() as db:
                    state = await self._get_or_create_state(db)
                    state.indexed_documents = len(already_indexed)
                    state.indexed_doc_ids = json.dumps(list(already_indexed))
                    await db.commit()

                progress = min(i + batch_size, len(documents))
                logger.info(f"Indexed {progress}/{len(documents)} documents ({len(already_indexed)} total, batch chunks: {chunk_count})")
                await asyncio.sleep(0.1)

            logger.info("Building BM25 index...")
            self.search_engine.finalize_bm25()

            async with async_session() as db:
                state = await self._get_or_create_state(db)
                state.status = "completed"
                state.total_documents = total
                state.indexed_documents = len(already_indexed)
                state.indexed_doc_ids = json.dumps(list(already_indexed))
                state.last_indexed_at = datetime.utcnow()
                state.error_message = ""
                await db.commit()

            logger.info(f"Indexing complete: {len(already_indexed)} documents indexed")

        except Exception as e:
            logger.error(f"Indexing error: {e}", exc_info=True)
            async with async_session() as db:
                state = await self._get_or_create_state(db)
                state.status = "error"
                state.error_message = str(e)
                await db.commit()

    async def _fetch_all_documents(self, client) -> list:
        documents = []
        page = 1
        max_retries = 3
        while True:
            success = False
            for attempt in range(max_retries):
                try:
                    result = await client._request("GET", "/documents/", params={"page": page, "page_size": 100})
                    if not result or not result.get("results"):
                        return documents
                    for doc in result["results"]:
                        documents.append({
                            "id": doc["id"],
                            "title": doc.get("title", ""),
                            "content": doc.get("content", ""),
                            "correspondent": doc.get("correspondent"),
                            "correspondent_name": "",
                            "document_type": doc.get("document_type"),
                            "document_type_name": "",
                            "tags": doc.get("tags", []),
                            "tag_names": [],
                            "created": doc.get("created", ""),
                            "added": doc.get("added", ""),
                        })
                    success = True
                    if not result.get("next"):
                        logger.info(f"Fetched {len(documents)} documents from Paperless")
                        return documents
                    page += 1
                    break
                except Exception as e:
                    if attempt < max_retries - 1:
                        logger.warning(f"Error fetching page {page} (attempt {attempt + 1}/{max_retries}): {e}")
                        await asyncio.sleep(2 ** attempt)
                    else:
                        logger.error(f"Failed to fetch page {page} after {max_retries} attempts: {e}")

            if not success:
                break

        logger.info(f"Fetched {len(documents)} documents from Paperless (may be incomplete)")
        return documents

    async def get_status(self) -> dict:
        async with async_session() as db:
            state = await self._get_or_create_state(db)
            if state.status == "indexing" and not self.is_indexing:
                state.status = "idle"
                await db.commit()
            return {
                "status": state.status,
                "total_documents": state.total_documents,
                "indexed_documents": state.indexed_documents,
                "last_indexed_at": state.last_indexed_at.isoformat() if state.last_indexed_at else None,
                "error_message": state.error_message,
                "chunks_in_index": self.search_engine.total_chunks,
            }

    @property
    def is_indexing(self) -> bool:
        return self._indexing_task is not None and not self._indexing_task.done()
