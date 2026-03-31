import logging
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.requests import Request

logger = logging.getLogger(__name__)
router = APIRouter()

# Singleton RAG service instance
_rag_service = None


def get_rag_service():
    global _rag_service
    if _rag_service is None:
        from app.services.rag.service import RAGService
        _rag_service = RAGService()
    return _rag_service


async def _check_api_auth(request: Request) -> bool:
    auth = request.headers.get("Authorization", "")
    api_key_param = request.query_params.get("api_key", "")
    if not auth and not api_key_param:
        return True
    from app.database import async_session
    from app.routers.api_keys import validate_api_key
    async with async_session() as db:
        key = await validate_api_key(request, db)
        return key is not None


# --- Request / Response Models ---

class SearchFilters(BaseModel):
    tags: Optional[List[int]] = None
    correspondent_id: Optional[int] = None
    document_type_id: Optional[int] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class ChatRequest(BaseModel):
    question: str
    session_id: Optional[str] = None
    filters: Optional[SearchFilters] = None


class SearchRequest(BaseModel):
    query: str
    limit: int = Field(default=10, ge=1, le=50)
    filters: Optional[SearchFilters] = None


class IndexRequest(BaseModel):
    force: bool = False


class ConfigUpdate(BaseModel):
    embedding_provider: Optional[str] = None
    embedding_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    bm25_weight: Optional[float] = None
    semantic_weight: Optional[float] = None
    max_sources: Optional[int] = None
    max_context_tokens: Optional[int] = None
    chat_model_provider: Optional[str] = None
    chat_model: Optional[str] = None
    chat_system_prompt: Optional[str] = None
    auto_index_enabled: Optional[bool] = None
    auto_index_interval: Optional[int] = None
    query_rewrite_enabled: Optional[bool] = None
    contextual_retrieval_enabled: Optional[bool] = None
    rag_enabled: Optional[bool] = None


# --- Chat Endpoints ---

@router.post("/chat")
async def chat(body: ChatRequest, request: Request):
    if not await _check_api_auth(request):
        raise HTTPException(status_code=401, detail="Ungültiger API-Key")
    service = get_rag_service()
    filters = body.filters.model_dump(exclude_none=True) if body.filters else None

    async def event_stream():
        try:
            async for chunk in service.chat_stream(
                question=body.question,
                session_id=body.session_id,
                filters=filters,
            ):
                yield f"data: {chunk}\n\n"
        except Exception as e:
            logger.error(f"Chat stream error: {e}", exc_info=True)
            import json
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# --- Search Endpoint ---

@router.post("/search")
async def search(body: SearchRequest, request: Request):
    if not await _check_api_auth(request):
        raise HTTPException(status_code=401, detail="Ungültiger API-Key")
    service = get_rag_service()
    filters = body.filters.model_dump(exclude_none=True) if body.filters else None

    results = await service.search(
        query=body.query,
        limit=body.limit,
        filters=filters,
    )
    return {
        "query": body.query,
        "results": [r.to_dict() for r in results],
        "total": len(results),
    }


# --- Indexing Endpoints ---

@router.post("/index/start")
async def start_indexing(request: IndexRequest):
    service = get_rag_service()
    if service.indexer.is_indexing:
        raise HTTPException(status_code=409, detail="Indexierung läuft bereits")

    await service.indexer.start_indexing(force=request.force)
    return {"status": "started", "force": request.force}


@router.get("/index/status")
async def indexing_status():
    service = get_rag_service()
    return await service.indexer.get_status()


# --- Session Endpoints ---

@router.get("/sessions")
async def list_sessions():
    service = get_rag_service()
    return await service.get_sessions()


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    service = get_rag_service()
    session = await service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session nicht gefunden")
    return session


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    service = get_rag_service()
    deleted = await service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session nicht gefunden")
    return {"deleted": True}


# --- Config Endpoints ---

@router.get("/config")
async def get_config():
    service = get_rag_service()
    return await service.get_config_dict()


@router.put("/config")
async def update_config(request: ConfigUpdate):
    service = get_rag_service()
    updates = request.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Keine Änderungen angegeben")
    return await service.update_config(updates)


# --- Health Check ---

@router.get("/health")
async def rag_health():
    service = get_rag_service()
    config = await service.get_config_dict()
    from app.services.rag.embedding_service import EmbeddingService
    embed_service = EmbeddingService(
        provider=config["embedding_provider"],
        model=config["embedding_model"],
        ollama_base_url=config["ollama_base_url"],
    )
    health = await embed_service.check_health()
    index_status = await service.indexer.get_status()
    return {
        "embedding": health,
        "index": index_status,
    }
