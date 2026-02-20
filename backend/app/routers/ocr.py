"""OCR Router - Endpoints for OCR via Ollama Vision models."""

import asyncio
import json
import logging
import time
import traceback
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List

import httpx

from app.services.paperless_client import PaperlessClient, get_paperless_client
from app.services.ocr_service import OcrService, batch_state, watchdog_state, single_ocr_running, load_review_queue, save_review_queue, load_ocr_ignore_list, save_ocr_ignore_list, DEFAULT_OLLAMA_URL, DEFAULT_OCR_MODEL
import app.services.ocr_service as ocr_service_module
from app.services.llm_provider import LLMProviderService, get_llm_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Persistent OCR settings file
SETTINGS_FILE = Path("/app/data/ocr_settings.json")


def load_ocr_settings() -> dict:
    """Load OCR settings from file, or return defaults."""
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r") as f:
                settings = json.load(f)
                if "ollama_urls" not in settings:
                    settings["ollama_urls"] = [settings.get("ollama_url", DEFAULT_OLLAMA_URL)]
                return settings
        except Exception:
            pass
    return {
        "ollama_url": DEFAULT_OLLAMA_URL, 
        "ollama_urls": [DEFAULT_OLLAMA_URL],
        "model": DEFAULT_OCR_MODEL,
        "max_image_size": 1344,
        "smart_skip_enabled": True
    }


def save_ocr_settings_to_file(settings: dict):
    """Save OCR settings to file."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f)


# Load on startup
ocr_settings = load_ocr_settings()


# --- Pydantic Models ---

class OcrSettingsRequest(BaseModel):
    ollama_url: str = DEFAULT_OLLAMA_URL
    ollama_urls: Optional[List[str]] = None
    model: str = DEFAULT_OCR_MODEL
    max_image_size: int = 1344
    smart_skip_enabled: bool = True


class OcrApplyRequest(BaseModel):
    content: str
    set_finish_tag: bool = True


class BatchOcrRequest(BaseModel):
    mode: str = "all"  # "all", "tagged", "manual"
    document_ids: Optional[List[int]] = None
    set_finish_tag: bool = True
    remove_runocr_tag: bool = True


class OcrCompareRequest(BaseModel):
    document_id: int
    models: List[str]
    page: int = 1  # Which page to compare (1-based, 0 = all pages)


class OcrEvaluateRequest(BaseModel):
    document_title: str
    results: List[dict]  # [{model, text, chars, duration_seconds}]
    evaluation_model: Optional[str] = None  # Override: e.g. "gpt-4.1", "o3", "gpt-4o"


# --- Helper ---

def get_ocr_service() -> OcrService:
    """Get OCR service with current settings."""
    return OcrService(
        ollama_url=ocr_settings.get("ollama_url", DEFAULT_OLLAMA_URL),
        ollama_urls=ocr_settings.get("ollama_urls", []),
        model=ocr_settings["model"],
        max_image_size=ocr_settings.get("max_image_size", 1344),
        smart_skip_enabled=ocr_settings.get("smart_skip_enabled", True)
    )


# --- Settings Endpoints ---

@router.get("/settings")
async def get_ocr_settings():
    """Get current OCR settings."""
    # Merge global settings with memory state
    settings = ocr_settings.copy()
    settings["watchdog_enabled"] = watchdog_state["enabled"]
    settings["watchdog_interval"] = watchdog_state["interval_minutes"]
    return settings


@router.post("/settings")
async def save_ocr_settings_endpoint(request: OcrSettingsRequest, client: PaperlessClient = Depends(get_paperless_client)):
    """Save OCR settings."""
    ocr_settings["ollama_url"] = request.ollama_url
    if request.ollama_urls:
         ocr_settings["ollama_urls"] = request.ollama_urls
    else:
         ocr_settings["ollama_urls"] = [request.ollama_url]
         
    ocr_settings["model"] = request.model
    ocr_settings["max_image_size"] = request.max_image_size
    ocr_settings["smart_skip_enabled"] = request.smart_skip_enabled
    
    # Handle watchdog settings if present (need to update Pydantic model first)
    # For now, we assume they might be in request if we update model
    
    save_ocr_settings_to_file(ocr_settings)
    return {"success": True, **ocr_settings}

# --- Watchdog Endpoints ---

class WatchdogSettingsRequest(BaseModel):
    enabled: bool
    interval_minutes: int = 1

@router.get("/watchdog/status")
async def get_watchdog_status():
    """Get watchdog status."""
    return {
        "enabled": watchdog_state["enabled"],
        "running": watchdog_state["running"],
        "interval_minutes": watchdog_state["interval_minutes"],
        "last_run": watchdog_state["last_run"]
    }

@router.post("/watchdog/settings")
async def set_watchdog_settings(
    request: WatchdogSettingsRequest, 
    background_tasks: BackgroundTasks,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Enable/Disable watchdog and set interval."""
    watchdog_state["interval_minutes"] = max(1, request.interval_minutes)
    
    # Update persistence
    ocr_settings["watchdog_enabled"] = request.enabled
    ocr_settings["watchdog_interval"] = request.interval_minutes
    save_ocr_settings_to_file(ocr_settings)
    
    if request.enabled and not watchdog_state["enabled"]:
        # Start watchdog
        watchdog_state["enabled"] = True
        service = get_ocr_service()
        # We need to run this as a long-running background task
        # background_tasks is for one-off. For permanent loop, we need asyncio.create_task?
        # But we don't have the loop handy easily here? 
        # Actually background_tasks.add_task works for long running too, but better manage it.
        
        # We attach it to the event loop
        loop = asyncio.get_running_loop()
        watchdog_state["task"] = loop.create_task(service.watchdog_loop(client))
        
    elif not request.enabled and watchdog_state["enabled"]:
        # Stop watchdog
        watchdog_state["enabled"] = False
        # Task will exit on next loop
        
    return get_watchdog_status()


# --- Batch Control Endpoints ---

@router.post("/batch/pause")
async def pause_batch_ocr():
    """Pause the running batch OCR job."""
    if not batch_state["running"]:
        return {"success": False, "message": "Kein Batch-Job aktiv"}
    
    batch_state["paused"] = True
    return {"success": True, "message": "Batch-Job pausiert", "paused": True}

@router.post("/batch/resume")
async def resume_batch_ocr():
    """Resume the paused batch OCR job."""
    if not batch_state["running"]:
        return {"success": False, "message": "Kein Batch-Job aktiv"}
    
    batch_state["paused"] = False
    return {"success": True, "message": "Batch-Job fortgesetzt", "paused": False}

# On startup, check if we should start watchdog
@router.on_event("startup")
async def on_startup():
    """Start watchdog if enabled in settings."""
    if ocr_settings.get("watchdog_enabled"):
        try:
            # We need a client. get_paperless_client depends on nothing?
            # It creates a client.
            client = PaperlessClient() 
            service = get_ocr_service()
            
            logger.info("Starting Watchdog on startup...")
            watchdog_state["enabled"] = True
            watchdog_state["interval_minutes"] = ocr_settings.get("watchdog_interval", 1)
            
            loop = asyncio.get_running_loop()
            watchdog_state["task"] = loop.create_task(service.watchdog_loop(client))
        except Exception as e:
            logger.error(f"Failed to start watchdog on startup: {e}")

# ... (Original imports and other endpoints)

# --- Tag Management ---

@router.get("/tags/ensure")
async def ensure_ocr_tags(
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Ensure runocr and ocrfinish tags exist in Paperless."""
    try:
        runocr_tag = await client.get_or_create_tag("runocr")
        ocrfinish_tag = await client.get_or_create_tag("ocrfinish")
        return {
            "runocr": {"id": runocr_tag.get("id"), "name": "runocr"},
            "ocrfinish": {"id": ocrfinish_tag.get("id"), "name": "ocrfinish"}
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tag-Fehler: {str(e)}")


@router.post("/test-connection")
async def test_ocr_connection():
    """Test connection to Ollama."""
    service = get_ocr_service()
    result = await service.test_connection()
    # Add model name to result for UI feedback
    result["model"] = service.model
    result["url"] = service.get_current_url()
    return result


@router.get("/stats")
async def get_ocr_stats():
    """Get OCR statistics."""
    service = get_ocr_service()
    return service.get_stats()


@router.get("/status")
async def get_ocr_status(
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Get overall OCR status - total docs, finished docs, percentage. Uses count-only queries for speed."""
    try:
        # Get ocrfinish tag ID (cached via get_or_create_tag)
        ocrfinish_tag = await client.get_or_create_tag("ocrfinish")
        ocrfinish_id = ocrfinish_tag.get("id")
        
        # Fast parallel count queries (page_size=1, only reads "count" field)
        total_count = await client.get_document_count()
        finished_count = await client.get_document_count(tag_id=ocrfinish_id) if ocrfinish_id else 0
        
        percentage = round((finished_count / total_count * 100), 1) if total_count > 0 else 0
        pending_count = total_count - finished_count
        
        return {
            "total_documents": total_count,
            "finished_documents": finished_count,
            "pending_documents": pending_count,
            "percentage": percentage,
            "ocrfinish_tag_id": ocrfinish_id
        }
    except Exception as e:
        logger.error(f"Error getting OCR status: {e}")
        raise HTTPException(status_code=500, detail=f"Fehler beim Abrufen des OCR-Status: {str(e)}")


# --- Single Document OCR ---

@router.post("/single/{document_id}")
async def ocr_single_document(
    document_id: int,
    force: bool = False,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Run OCR on a single document and return old vs new content."""
    try:
        ocr_service_module.single_ocr_running = True
        service = get_ocr_service()
        result = await service.ocr_document(client, document_id, force=force)
        return result
    except ValueError as e:
        error_msg = str(e)
        logger.error(f"OCR ValueError for doc {document_id}: {error_msg}")
        if "nicht gefunden" in error_msg and f"Dokument {document_id}" in error_msg:
            raise HTTPException(status_code=404, detail=error_msg)
        raise HTTPException(status_code=422, detail=f"OCR Verarbeitungsfehler: {error_msg}")
    except Exception as e:
        logger.error(f"OCR single document error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"OCR Fehler: {str(e)}")
    finally:
        ocr_service_module.single_ocr_running = False


@router.post("/apply/{document_id}")
async def apply_ocr_result(
    document_id: int,
    request: OcrApplyRequest,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Apply new OCR content to a document.
    
    Fires off the Paperless update as async task for instant response.
    The PATCH to Paperless can take 20-30s due to full-text re-indexing,
    so we don't make the user wait.
    """
    print(f"[OCR] Request to apply result for doc {document_id}")
    
    async def _apply_in_background():
        try:
            service = get_ocr_service()
            await service.apply_ocr_result(
                client, document_id, request.content, request.set_finish_tag
            )
            print(f"[OCR] Successfully applied result for doc {document_id}")
        except Exception as e:
            print(f"[OCR] Error applying result for doc {document_id}: {e}")
            logger.error(f"Background apply error: {e}")
    
    # Fire and forget: don't wait for Paperless re-indexing
    asyncio.create_task(_apply_in_background())
    return {"success": True, "document_id": document_id, "status": "saving"}


# --- Batch OCR ---

@router.post("/batch/start")
async def start_batch_ocr(
    request: BatchOcrRequest,
    background_tasks: BackgroundTasks,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Start batch OCR processing in the background."""
    if batch_state["running"]:
        raise HTTPException(status_code=409, detail="Ein Batch-OCR-Job läuft bereits")
    
    service = get_ocr_service()
    
    # Run batch OCR as background task
    background_tasks.add_task(
        service.batch_ocr,
        client,
        request.mode,
        request.document_ids,
        request.set_finish_tag,
        request.remove_runocr_tag
    )
    
    return {"started": True, "mode": request.mode}


@router.get("/batch/status")
async def get_batch_status():
    """Get current batch OCR job status."""
    return {
        "running": batch_state["running"],
        "total": batch_state["total"],
        "processed": batch_state["processed"],
        "current_document": batch_state["current_document"],
        "errors_count": len(batch_state["errors"]),
        "log": batch_state["log"][-50:],  # Last 50 log entries
        "mode": batch_state["mode"]
    }


@router.post("/batch/stop")
async def stop_batch_ocr():
    """Stop the running batch OCR job."""
    if not batch_state["running"]:
        return {"stopped": False, "message": "Kein Batch-Job aktiv"}
    
    batch_state["should_stop"] = True
    return {"stopped": True, "message": "Batch-Job wird gestoppt..."}


# --- Tag Management ---

@router.get("/tags/ensure")
async def ensure_ocr_tags(
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Ensure runocr and ocrfinish tags exist in Paperless."""
    try:
        runocr_tag = await client.get_or_create_tag("runocr")
        ocrfinish_tag = await client.get_or_create_tag("ocrfinish")
        return {
            "runocr": {"id": runocr_tag.get("id"), "name": "runocr"},
            "ocrfinish": {"id": ocrfinish_tag.get("id"), "name": "ocrfinish"}
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tag-Fehler: {str(e)}")


# --- Review Queue ---

@router.get("/review/queue")
async def get_review_queue():
    """Get all documents in the OCR review queue."""
    queue = load_review_queue()
    return {"items": queue, "count": len(queue)}


@router.post("/review/apply/{document_id}")
async def apply_review_item(
    document_id: int,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Apply review queue item (accept the new OCR text)."""
    queue = load_review_queue()
    item = next((q for q in queue if q["document_id"] == document_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Dokument nicht in Review Queue")
    
    try:
        service = get_ocr_service()
        await service.apply_ocr_result(client, document_id, item["new_content"], True)
        # Remove from queue
        queue = [q for q in queue if q["document_id"] != document_id]
        save_review_queue(queue)
        return {"applied": True, "document_id": document_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/review/dismiss/{document_id}")
async def dismiss_review_item(document_id: int):
    """Dismiss review queue item (discard the new OCR text)."""
    queue = load_review_queue()
    new_queue = [q for q in queue if q["document_id"] != document_id]
    if len(new_queue) == len(queue):
        raise HTTPException(status_code=404, detail="Dokument nicht in Review Queue")
    save_review_queue(new_queue)
    return {"dismissed": True, "document_id": document_id}


@router.post("/review/ignore/{document_id}")
async def ignore_review_item(document_id: int):
    """Ignore document permanently: remove from review queue and add to OCR ignore list."""
    # Remove from review queue
    queue = load_review_queue()
    item = next((q for q in queue if q["document_id"] == document_id), None)
    title = item["title"] if item else f"Dokument {document_id}"
    new_queue = [q for q in queue if q["document_id"] != document_id]
    save_review_queue(new_queue)
    
    # Add to ignore list (avoid duplicates)
    ignore_list = load_ocr_ignore_list()
    if not any(entry["document_id"] == document_id for entry in ignore_list):
        ignore_list.append({
            "document_id": document_id,
            "title": title,
            "reason": "Original besser als OCR",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
        })
        save_ocr_ignore_list(ignore_list)
    
    return {"ignored": True, "document_id": document_id, "title": title}


# --- OCR Ignore List ---

@router.get("/ignore/list")
async def get_ocr_ignore_list():
    """Get all documents on the OCR ignore list."""
    ignore_list = load_ocr_ignore_list()
    return {"items": ignore_list, "count": len(ignore_list)}


@router.post("/ignore/add/{document_id}")
async def add_to_ocr_ignore_list(
    document_id: int,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Add a document to the OCR ignore list."""
    ignore_list = load_ocr_ignore_list()
    if any(entry["document_id"] == document_id for entry in ignore_list):
        return {"already_ignored": True, "document_id": document_id}
    
    # Try to get document title from Paperless
    title = f"Dokument {document_id}"
    try:
        doc = await client.get_document(document_id)
        if doc:
            title = doc.get("title", title)
    except Exception:
        pass
    
    ignore_list.append({
        "document_id": document_id,
        "title": title,
        "reason": "Original besser als OCR",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
    })
    save_ocr_ignore_list(ignore_list)
    return {"added": True, "document_id": document_id, "title": title}


@router.delete("/ignore/remove/{document_id}")
async def remove_from_ocr_ignore_list(document_id: int):
    """Remove a document from the OCR ignore list."""
    ignore_list = load_ocr_ignore_list()
    new_list = [entry for entry in ignore_list if entry["document_id"] != document_id]
    if len(new_list) == len(ignore_list):
        raise HTTPException(status_code=404, detail="Dokument nicht in der Ignore-Liste")
    save_ocr_ignore_list(new_list)
    return {"removed": True, "document_id": document_id}


# --- Document Preview Proxy ---

@router.get("/preview/{document_id}")
async def get_document_preview(
    document_id: int,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Proxy document preview from Paperless. Auto-detects PDF vs image."""
    try:
        file_bytes = await client.get_document_preview_image(document_id)
        
        if file_bytes[:4] == b'%PDF':
            return Response(content=file_bytes, media_type="application/pdf")
        elif file_bytes[:4] == b'\x89PNG':
            return Response(content=file_bytes, media_type="image/png")
        elif file_bytes[:2] == b'\xff\xd8':
            return Response(content=file_bytes, media_type="image/jpeg")
        elif file_bytes[:4] == b'RIFF':
            return Response(content=file_bytes, media_type="image/webp")
        else:
            return Response(content=file_bytes, media_type="application/octet-stream")
    except Exception as e:
        logger.error(f"Error getting preview for {document_id}: {e}")
        raise HTTPException(status_code=404, detail="Preview not found")


@router.get("/thumbnail/{document_id}")
async def get_document_thumbnail(
    document_id: int,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Proxy document thumbnail from Paperless (small image, handles auth)."""
    try:
        image_bytes = await client.get_document_thumbnail_bytes(document_id)
        if image_bytes[:4] == b'\x89PNG':
            return Response(content=image_bytes, media_type="image/png")
        return Response(content=image_bytes, media_type="image/webp")
    except Exception as e:
        logger.error(f"Error getting thumbnail for {document_id}: {e}")
        raise HTTPException(status_code=404, detail="Thumbnail not found")


# --- OCR Model Comparison ---

@router.get("/models")
async def get_ollama_models():
    """Get all available models from all configured Ollama servers."""
    urls = ocr_settings.get("ollama_urls", [ocr_settings.get("ollama_url", DEFAULT_OLLAMA_URL)])
    all_models = set()
    
    for url in urls:
        url = url.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{url}/api/tags")
                if response.status_code == 200:
                    models = response.json().get("models", [])
                    for m in models:
                        name = m.get("name", "")
                        if name:
                            all_models.add(name)
        except Exception as e:
            logger.warning(f"Could not fetch models from {url}: {e}")
    
    sorted_models = sorted(all_models)
    current_model = ocr_settings.get("model", DEFAULT_OCR_MODEL)
    
    return {
        "models": sorted_models,
        "current_model": current_model
    }


# --- Compare State (in-memory, single job) ---
compare_state = {
    "running": False,
    "phase": "",  # "download", "convert", "model_loading", "ocr_page", "unloading", "done", "error"
    "current_model": "",
    "current_model_index": 0,
    "total_models": 0,
    "current_page": 0,
    "total_pages": 0,
    "models": [],
    "document_id": 0,
    "title": "",
    "old_content": "",
    "compared_page": 0,
    "results": [],
    "error": None,
    "elapsed_seconds": 0,
}

def reset_compare_state():
    compare_state.update({
        "running": False,
        "phase": "",
        "current_model": "",
        "current_model_index": 0,
        "total_models": 0,
        "current_page": 0,
        "total_pages": 0,
        "models": [],
        "document_id": 0,
        "title": "",
        "old_content": "",
        "compared_page": 0,
        "results": [],
        "error": None,
        "elapsed_seconds": 0,
    })


async def _unload_model_from_vram(model: str):
    """Send keep_alive=0 to Ollama to immediately unload model from VRAM."""
    urls = ocr_settings.get("ollama_urls", [ocr_settings.get("ollama_url", DEFAULT_OLLAMA_URL)])
    for url in urls:
        url = url.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    f"{url}/api/chat",
                    json={"model": model, "messages": [], "keep_alive": 0}
                )
                print(f"[Compare] Unloaded {model} from VRAM")
                return
        except Exception:
            pass


async def _wait_for_ollama_ready(max_wait: int = 60) -> bool:
    """Wait until at least one Ollama server responds. Returns True if ready."""
    urls = ocr_settings.get("ollama_urls", [ocr_settings.get("ollama_url", DEFAULT_OLLAMA_URL)])
    waited = 0
    interval = 3
    
    while waited < max_wait:
        for url in urls:
            url = url.rstrip("/")
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp = await client.get(f"{url}/api/tags")
                    if resp.status_code == 200:
                        if waited > 0:
                            print(f"[Compare] Ollama wieder erreichbar nach {waited}s Wartezeit ({url})")
                        return True
            except Exception:
                pass
        
        print(f"[Compare] Ollama nicht erreichbar, warte {interval}s... ({waited}/{max_wait}s)")
        compare_state["phase"] = "waiting_ollama"
        compare_state["elapsed_seconds"] = round(time.time() - compare_state.get("_job_start", time.time()), 1)
        await asyncio.sleep(interval)
        waited += interval
    
    print(f"[Compare] Ollama nach {max_wait}s immer noch nicht erreichbar!")
    return False


async def _run_compare_job(paperless_client, document_id: int, models: list, target_page: int):
    """Background task that runs the actual model comparison."""
    import io
    from PIL import Image
    from pdf2image import convert_from_bytes
    
    job_start = time.time()
    compare_state["_job_start"] = job_start
    
    try:
        # Phase: Download
        compare_state["phase"] = "download"
        doc = await paperless_client.get_document(document_id)
        if not doc:
            raise ValueError(f"Dokument {document_id} nicht gefunden")
        
        compare_state["title"] = doc.get("title", f"Dokument {document_id}")
        compare_state["old_content"] = doc.get("content", "") or ""
        
        file_bytes = await paperless_client.download_document_file(document_id)
        print(f"[Compare] Downloaded doc {document_id}: {len(file_bytes)} bytes")
        
        # Phase: Initial convert (for page count detection)
        compare_state["phase"] = "convert"
        is_pdf = True
        try:
            loop = asyncio.get_running_loop()
            preview_images = await loop.run_in_executor(
                None, lambda: convert_from_bytes(file_bytes, dpi=150)
            )
            total_pages = len(preview_images)
            print(f"[Compare] Document has {total_pages} pages")
        except Exception:
            is_pdf = False
            img = Image.open(io.BytesIO(file_bytes))
            preview_images = [img]
            total_pages = 1
        
        if total_pages == 0:
            raise ValueError("Keine Seiten extrahiert")
        
        compare_state["total_pages"] = total_pages
        
        # Select page indices
        if target_page > 0 and target_page <= total_pages:
            page_indices = [target_page - 1]
            compare_state["compared_page"] = target_page
        else:
            page_indices = list(range(total_pages))
            compare_state["compared_page"] = 0
        
        # Cache for DPI-specific image conversions (avoid re-rendering same DPI)
        dpi_image_cache = {}
        
        # Run each model with model-specific image preparation
        for model_idx, model_name in enumerate(models):
            compare_state["current_model"] = model_name
            compare_state["current_model_index"] = model_idx
            compare_state["current_page"] = 0
            compare_state["elapsed_seconds"] = round(time.time() - job_start, 1)
            
            # Health check: wait for Ollama to be ready before starting each model
            compare_state["phase"] = "health_check"
            print(f"[Compare] Checking Ollama health before model: {model_name}")
            ollama_ok = await _wait_for_ollama_ready(max_wait=60)
            if not ollama_ok:
                error_msg = f"Ollama nicht erreichbar - überspringe {model_name}"
                print(f"[Compare] {model_name} SKIPPED: Ollama not reachable")
                compare_state["results"].append({
                    "model": model_name,
                    "text": "",
                    "chars": 0,
                    "duration_seconds": 0,
                    "pages_processed": 0,
                    "error": error_msg
                })
                continue
            
            # Get model-specific optimal parameters
            model_params = OcrService.get_model_params(model_name)
            optimal_image_size = model_params["max_image_size"]
            render_dpi = model_params.get("render_dpi", 200)
            
            compare_state["phase"] = "model_loading"
            print(f"[Compare] Testing model: {model_name} (image: {optimal_image_size}px, DPI: {render_dpi}, ctx: {model_params['num_ctx']}, repeat_pen: {model_params['repeat_penalty']})")
            
            service = OcrService(
                ollama_url=ocr_settings.get("ollama_url", DEFAULT_OLLAMA_URL),
                ollama_urls=ocr_settings.get("ollama_urls", []),
                model=model_name,
                max_image_size=optimal_image_size,
                smart_skip_enabled=False
            )
            
            # Convert PDF at the right DPI for this model (cached)
            if is_pdf and render_dpi not in dpi_image_cache:
                compare_state["phase"] = "convert"
                print(f"[Compare] Rendering PDF at {render_dpi} DPI for {model_name}")
                dpi_images = await loop.run_in_executor(
                    None, lambda dpi=render_dpi: convert_from_bytes(file_bytes, dpi=dpi)
                )
                dpi_image_cache[render_dpi] = dpi_images
            
            source_images = dpi_image_cache.get(render_dpi, preview_images) if is_pdf else preview_images
            pages_to_process = [(idx, source_images[idx]) for idx in page_indices]
            
            # Prepare images at the optimal resolution for THIS model
            prepared_pages = []
            for idx, img in pages_to_process:
                src_w, src_h = img.size
                prepared_bytes = service._prepare_image_for_ollama(img, max_size=optimal_image_size)
                # Debug: log exact image info
                from PIL import Image as PilImage
                debug_img = PilImage.open(io.BytesIO(prepared_bytes))
                prep_w, prep_h = debug_img.size
                print(f"[Compare][DEBUG] {model_name} page {idx+1}: source={src_w}x{src_h}, prepared={prep_w}x{prep_h}, bytes={len(prepared_bytes)}, format={debug_img.format}")
                prepared_pages.append((idx, prepared_bytes))
            
            model_start = time.time()
            page_texts = []
            error_msg = None
            
            try:
                for page_idx, prepared_bytes in prepared_pages:
                    compare_state["phase"] = "ocr_page"
                    compare_state["current_page"] = page_idx + 1
                    compare_state["elapsed_seconds"] = round(time.time() - job_start, 1)
                    
                    page_text = await service._ocr_single_image(
                        prepared_bytes,
                        page_num=page_idx + 1,
                        total_pages=total_pages,
                        timeout=300.0
                    )
                    # Debug: log first 200 chars of OCR result
                    preview = page_text[:200].replace('\n', ' ') if page_text else "(empty)"
                    print(f"[Compare][DEBUG] {model_name} page {page_idx+1} result: {len(page_text)} chars, preview: {preview}")
                    page_texts.append(page_text)
            except Exception as e:
                error_msg = str(e)
                error_type = type(e).__name__
                logger.error(f"[Compare] Model {model_name} failed ({error_type}): {e}")
                print(f"[Compare] {model_name} FAILED ({error_type}): {e}")
            
            model_duration = time.time() - model_start
            full_text = "\n\n".join(page_texts) if page_texts else ""
            
            compare_state["results"].append({
                "model": model_name,
                "text": full_text,
                "chars": len(full_text),
                "duration_seconds": round(model_duration, 2),
                "pages_processed": len(page_texts),
                "error": error_msg
            })
            
            print(f"[Compare] {model_name}: {len(full_text)} chars in {model_duration:.1f}s")
            
            # Unload model from VRAM before loading the next
            compare_state["phase"] = "unloading"
            compare_state["elapsed_seconds"] = round(time.time() - job_start, 1)
            await _unload_model_from_vram(model_name)
            
            # If model had an error, wait for Ollama to recover before next model
            if error_msg:
                print(f"[Compare] Modell hatte Fehler, warte 5s auf Ollama-Recovery...")
                await asyncio.sleep(5)
        
        compare_state["phase"] = "done"
        compare_state["elapsed_seconds"] = round(time.time() - job_start, 1)
        print(f"[Compare] All {len(models)} models done in {compare_state['elapsed_seconds']}s")
        
    except Exception as e:
        compare_state["phase"] = "error"
        compare_state["error"] = str(e)
        compare_state["elapsed_seconds"] = round(time.time() - job_start, 1)
        logger.error(f"[Compare] Job failed: {e}")
    finally:
        compare_state["running"] = False


@router.post("/compare")
async def start_compare(
    request: OcrCompareRequest,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Start OCR model comparison as background task."""
    if compare_state["running"]:
        raise HTTPException(status_code=409, detail="Ein Vergleich läuft bereits")
    
    models = request.models
    if not models or len(models) == 0:
        raise HTTPException(status_code=400, detail="Mindestens ein Modell auswählen")
    if len(models) > 5:
        raise HTTPException(status_code=400, detail="Maximal 5 Modelle gleichzeitig")
    
    reset_compare_state()
    compare_state["running"] = True
    compare_state["document_id"] = request.document_id
    compare_state["models"] = models
    compare_state["total_models"] = len(models)
    compare_state["phase"] = "starting"
    
    asyncio.create_task(_run_compare_job(client, request.document_id, models, request.page))
    
    return {"started": True, "models": len(models)}


@router.get("/compare/status")
async def get_compare_status():
    """Get current compare job status (for polling)."""
    return {
        "running": compare_state["running"],
        "phase": compare_state["phase"],
        "current_model": compare_state["current_model"],
        "current_model_index": compare_state["current_model_index"],
        "total_models": compare_state["total_models"],
        "current_page": compare_state["current_page"],
        "total_pages": compare_state["total_pages"],
        "models": compare_state["models"],
        "document_id": compare_state["document_id"],
        "title": compare_state["title"],
        "old_content": compare_state["old_content"],
        "compared_page": compare_state["compared_page"],
        "results": compare_state["results"],
        "error": compare_state["error"],
        "elapsed_seconds": compare_state["elapsed_seconds"],
    }


@router.post("/compare/evaluate")
async def evaluate_ocr_results(
    request: OcrEvaluateRequest,
    llm_service: LLMProviderService = Depends(get_llm_service)
):
    """Send OCR comparison results to an external LLM for quality evaluation.
    
    WARNING: This sends document text to a cloud API (OpenAI, Anthropic, etc.)!
    Uses a thorough multi-criteria evaluation inspired by professional OCR benchmarks.
    """
    if not llm_service.provider:
        raise HTTPException(
            status_code=400, 
            detail="Kein LLM-Provider konfiguriert. Bitte zuerst unter Einstellungen einen Provider (z.B. OpenAI) einrichten."
        )
    
    results = request.results
    if not results or len(results) < 1:
        raise HTTPException(status_code=400, detail="Keine OCR-Ergebnisse zum Auswerten")
    
    eval_model = request.evaluation_model or None
    
    # Build the evaluation prompt with full texts
    model_sections = []
    for i, r in enumerate(results):
        model_name = r.get("model", f"Modell {i+1}")
        text = r.get("text", "")
        chars = r.get("chars", len(text))
        duration = r.get("duration_seconds", 0)
        
        # Truncate very long texts to save tokens (first 4000 + last 1500 chars)
        if len(text) > 6000:
            display_text = text[:4000] + "\n\n[... gekürzt ...]\n\n" + text[-1500:]
        else:
            display_text = text
        
        model_sections.append(
            f"=== VERSION {i+1}: {model_name} ===\n"
            f"Zeichen: {chars} | Dauer: {duration}s\n"
            f"--- TEXT START ---\n{display_text}\n--- TEXT END ---"
        )
    
    models_text = "\n\n".join(model_sections)
    
    prompt = f"""Du bist ein erfahrener OCR-Qualitätsprüfer und Dokumentenanalyst. Du bewertest OCR-Ergebnisse für ein deutsches Dokumentenmanagementsystem (Paperless-ngx).

DOKUMENT: "{request.document_title}"
ANZAHL VERSIONEN: {len(results)}

Folgende OCR-Versionen desselben Dokuments wurden von verschiedenen lokalen Vision-Modellen (Ollama) erstellt. Vergleiche sie gründlich.

{models_text}

BEWERTUNGSANLEITUNG:
Du musst jede Version sorgfältig auf folgende Kriterien prüfen. Vergleiche die Versionen untereinander -- wenn mehrere Versionen den gleichen Wert haben, ist er wahrscheinlich korrekt. Abweichungen deuten auf Fehler hin.

KRITISCHE FELDER (Fehler hier = sofortiger Punktabzug):
- Namen (Vor-/Nachname): Auch ein einziger falscher Buchstabe ist ein Fehler
- Datumsangaben: Falsches Jahr/Monat = KO-Kriterium (schlimmer als Tippfehler!)
- IBAN/Kontonummern: Ziffern müssen exakt stimmen, Leerzeichen-Gruppierung egal
- Geldbeträge: Müssen exakt stimmen

WICHTIGE FELDER:
- Adressen, Zählernummern, Referenznummern
- Checkbox-Zustände (angekreuzt vs. leer)
- Formularlogik (Felder richtig zugeordnet?)

ALLGEMEINE QUALITÄT:
- Vollständigkeit (fehlen Textblöcke/Absätze?)
- Halluzinationen (hat das Modell Text erfunden der nicht im Original steht?)
- Wiederholungen (Textblöcke die sich wiederholen)
- Formatierung und Lesbarkeit

PRAXISTAUGLICHKEIT:
- Kann der Text automatisiert weiterverarbeitet werden?
- Wie viel manuelle Nacharbeit wäre nötig?

Antworte NUR mit validem JSON (kein Text davor/danach, keine Markdown-Codeblöcke):
{{
  "ranking": [
    {{
      "rank": 1,
      "model": "<modellname>",
      "overall_score": <0-100>,
      "category_scores": {{
        "names_persons": <0-10>,
        "dates_periods": <0-10>,
        "iban_banking": <0-10>,
        "amounts_numbers": <0-10>,
        "addresses": <0-10>,
        "form_logic": <0-10>,
        "completeness": <0-10>,
        "formatting": <0-10>,
        "no_hallucinations": <0-10>,
        "automatizability": <0-10>
      }},
      "speed_seconds": <dauer>,
      "strengths": ["Stärke 1", "Stärke 2"],
      "weaknesses": ["Schwäche 1"],
      "specific_errors": [
        {{"field": "Name", "expected": "korrekt", "got": "was das Modell geschrieben hat", "severity": "critical"}},
        {{"field": "IBAN", "expected": "DE12 3456...", "got": "DE12 3546...", "severity": "high"}}
      ],
      "verdict": "<1-2 Sätze Praxisurteil auf Deutsch>"
    }}
  ],
  "best_quality": "<modellname mit bester Qualität>",
  "best_speed": "<schnellstes Modell>",
  "best_value": "<bestes Preis-Leistungs-Verhältnis (Qualität vs. Geschwindigkeit)>",
  "recommendation": "<3-4 Sätze Empfehlung auf Deutsch: welches Modell für Produktion, welches Backup, welches nicht verwenden>",
  "critical_finding": "<wichtigste Erkenntnis, z.B. 'Datumsfehler bei Modell X sind ein KO-Kriterium'>",
  "cross_comparison": {{
    "agreement": ["Felder wo alle Versionen übereinstimmen"],
    "disagreement": ["Felder wo die Versionen sich widersprechen -- hier liegt wahrscheinlich mindestens ein Fehler"]
  }}
}}

WICHTIG:
- Severity-Stufen: "critical" (Daten, Namen, IBAN falsch), "high" (wichtige Felder), "medium" (Formatierung), "low" (kosmetisch)
- Score 0-100: unter 50 = nicht verwendbar, 50-70 = bedingt brauchbar, 70-85 = gut, 85+ = sehr gut
- Sei STRENG aber FAIR. Ein falsches Datum ist schlimmer als 5 Tippfehler.
- Wenn du nicht sicher bist ob ein Wert richtig ist, vergleiche die Versionen untereinander.
"""

    try:
        used_model = eval_model or llm_service.provider.model
        print(f"[Evaluate] Sending {len(results)} OCR results to {llm_service.provider.name} / {used_model}")
        
        raw_response = await llm_service.complete(prompt, model_override=eval_model)
        
        # Parse JSON from response (handle markdown code blocks)
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            cleaned = "\n".join(lines)
        
        try:
            evaluation = json.loads(cleaned)
        except json.JSONDecodeError:
            import re
            json_match = re.search(r'\{[\s\S]*\}', cleaned)
            if json_match:
                evaluation = json.loads(json_match.group())
            else:
                logger.error(f"Could not parse LLM response as JSON: {cleaned[:500]}")
                return {
                    "success": True,
                    "raw_response": raw_response,
                    "evaluation": None,
                    "parse_error": "LLM-Antwort konnte nicht als JSON geparst werden"
                }
        
        print(f"[Evaluate] Successfully evaluated with {llm_service.provider.name} / {used_model}")
        
        return {
            "success": True,
            "evaluation": evaluation,
            "provider": llm_service.provider.name,
            "model": used_model
        }
        
    except Exception as e:
        logger.error(f"Evaluation failed: {e}")
        raise HTTPException(status_code=500, detail=f"LLM-Auswertung fehlgeschlagen: {str(e)}")

