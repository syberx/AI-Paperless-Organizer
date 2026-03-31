import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import create_tables

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,
)
from app.routers import paperless, correspondents, tags, document_types, settings, llm, debug, statistics, ignored_items, ocr, cleanup, classifier, rag, api_keys
from app.routers.ocr import ocr_settings, get_ocr_service
from app.services.ocr_service import watchdog_state
from app.services.paperless_client import PaperlessClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from app.database import async_session
    from app.models.settings_model import PaperlessSettings
    from sqlalchemy import select as sa_select

    # Startup: Create database tables
    await create_tables()

    # Auto-start watchdog if it was enabled before shutdown
    if ocr_settings.get("watchdog_enabled"):
        try:
            async with async_session() as db_sess:
                result = await db_sess.execute(sa_select(PaperlessSettings).where(PaperlessSettings.id == 1))
                pl_settings = result.scalar_one_or_none()

            if pl_settings and pl_settings.is_configured:
                client = PaperlessClient(base_url=pl_settings.url, api_token=pl_settings.api_token)
                service = get_ocr_service()
                watchdog_state["enabled"] = True
                watchdog_state["interval_minutes"] = ocr_settings.get("watchdog_interval", 5)
                loop = asyncio.get_running_loop()
                watchdog_state["task"] = loop.create_task(service.watchdog_loop(client))
                logging.getLogger(__name__).info(
                    f"Watchdog auto-started (interval: {watchdog_state['interval_minutes']} min)"
                )
            else:
                logging.getLogger(__name__).warning(
                    "Watchdog: Paperless nicht konfiguriert – Watchdog wird nicht gestartet."
                )
        except Exception as e:
            logging.getLogger(__name__).error(f"Watchdog auto-start failed: {e}")

    # Auto-start classifier background job if enabled
    try:
        from app.models.classifier import ClassifierConfig
        async with async_session() as db_sess:
            q = await db_sess.execute(sa_select(ClassifierConfig).where(ClassifierConfig.id == 1))
            cls_config = q.scalars().first()
            if cls_config and getattr(cls_config, "auto_classify_enabled", False):
                from app.routers.classifier import _auto_classify_state, _auto_classify_loop
                _auto_classify_state["enabled"] = True
                asyncio.get_running_loop().create_task(_auto_classify_loop())
                logging.getLogger(__name__).info("Auto-classify auto-started")
    except Exception as e:
        logging.getLogger(__name__).error(f"Auto-classify auto-start failed: {e}")

    # Reset stale RAG indexing status + auto-resume incomplete indexing
    try:
        from app.models.rag import RagIndexingState, RagConfig as RagConfigModel
        async with async_session() as db_sess:
            result = await db_sess.execute(sa_select(RagIndexingState).where(RagIndexingState.id == 1))
            rag_state = result.scalar_one_or_none()
            cfg_result = await db_sess.execute(sa_select(RagConfigModel).where(RagConfigModel.id == 1))
            rag_cfg = cfg_result.scalar_one_or_none()

            # Auto-enable RAG for existing users who already have indexed data
            if (
                rag_cfg
                and not getattr(rag_cfg, "rag_enabled", False)
                and rag_state
                and rag_state.indexed_documents > 0
            ):
                rag_cfg.rag_enabled = True
                await db_sess.commit()
                logging.getLogger(__name__).info("RAG: auto-enabled for existing user with indexed data")

            rag_active = rag_cfg and getattr(rag_cfg, "rag_enabled", False)

            if rag_state and rag_state.status == "indexing":
                rag_state.status = "idle"
                await db_sess.commit()
                logging.getLogger(__name__).info("Reset stale RAG indexing status to 'idle'")

            # Auto-resume if indexing was incomplete and RAG is enabled
            if (
                rag_active
                and rag_state
                and rag_state.status in ("idle", "error", "indexing")
                and rag_state.total_documents > 0
                and rag_state.indexed_documents < rag_state.total_documents
            ):
                from app.routers.rag import get_rag_service
                asyncio.get_running_loop().create_task(get_rag_service().indexer.start_indexing(force=False))
                logging.getLogger(__name__).info(
                    f"RAG: auto-resuming indexing ({rag_state.indexed_documents}/{rag_state.total_documents} already done)"
                )
    except Exception as e:
        logging.getLogger(__name__).error(f"RAG status reset failed: {e}")

    yield
    # Shutdown: stop auto-classify + watchdog gracefully
    try:
        from app.routers.classifier import _auto_classify_state
        _auto_classify_state["enabled"] = False
        task = _auto_classify_state.get("task")
        if task and not task.done():
            task.cancel()
    except Exception:
        pass

    if watchdog_state.get("enabled"):
        watchdog_state["enabled"] = False
        task = watchdog_state.get("task")
        if task and not task.done():
            task.cancel()


app = FastAPI(
    title="AI Paperless Organizer",
    description="Intelligente Bereinigung von Korrespondenten, Tags und Dokumententypen in Paperless-ngx",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(paperless.router, prefix="/api/paperless", tags=["Paperless"])
app.include_router(correspondents.router, prefix="/api/correspondents", tags=["Correspondents"])
app.include_router(tags.router, prefix="/api/tags", tags=["Tags"])
app.include_router(document_types.router, prefix="/api/document-types", tags=["Document Types"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(llm.router, prefix="/api/llm", tags=["LLM"])
app.include_router(debug.router, prefix="/api/debug", tags=["Debug"])
app.include_router(statistics.router, prefix="/api/statistics", tags=["Statistics"])
app.include_router(ignored_items.router, prefix="/api/ignored-items", tags=["Ignored Items"])
app.include_router(ocr.router, prefix="/api/ocr", tags=["OCR"])
app.include_router(cleanup.router, prefix="/api/cleanup", tags=["Cleanup"])
app.include_router(classifier.router, prefix="/api/classifier", tags=["Classifier"])
app.include_router(rag.router, prefix="/api/rag", tags=["RAG"])
app.include_router(api_keys.router, prefix="/api/api-keys", tags=["API Keys"])


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "AI Paperless Organizer"}

