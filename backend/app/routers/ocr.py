"""OCR Router - Endpoints for OCR via Ollama Vision models."""

import asyncio
import json
import logging
import traceback
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List

from app.services.paperless_client import PaperlessClient, get_paperless_client
from app.services.ocr_service import OcrService, batch_state, DEFAULT_OLLAMA_URL, DEFAULT_OCR_MODEL

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
        "model": DEFAULT_OCR_MODEL
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


class OcrApplyRequest(BaseModel):
    content: str
    set_finish_tag: bool = True


class BatchOcrRequest(BaseModel):
    mode: str = "all"  # "all", "tagged", "manual"
    document_ids: Optional[List[int]] = None
    set_finish_tag: bool = True
    remove_runocr_tag: bool = True


# --- Helper ---

def get_ocr_service() -> OcrService:
    """Get OCR service with current settings."""
    return OcrService(
        ollama_url=ocr_settings.get("ollama_url", DEFAULT_OLLAMA_URL),
        ollama_urls=ocr_settings.get("ollama_urls", []),
        model=ocr_settings["model"]
    )


# --- Settings Endpoints ---

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
    
    # Handle watchdog settings if present (need to update Pydantic model first)
    # For now, we assume they might be in request if we update model
    
    save_ocr_settings_to_file(ocr_settings)
    return {"success": True, **ocr_settings}

# --- Watchdog Endpoints ---

class WatchdogSettingsRequest(BaseModel):
    enabled: bool
    interval_minutes: int = 5

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
            watchdog_state["interval_minutes"] = ocr_settings.get("watchdog_interval", 5)
            
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
    return result


@router.get("/stats")
async def get_ocr_stats():
    """Get OCR statistics."""
    service = get_ocr_service()
    return service.get_stats()


# --- Single Document OCR ---

@router.post("/single/{document_id}")
async def ocr_single_document(
    document_id: int,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Run OCR on a single document and return old vs new content."""
    try:
        service = get_ocr_service()
        result = await service.ocr_document(client, document_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"OCR single document error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"OCR Fehler: {str(e)}")


@router.post("/apply/{document_id}")
async def apply_ocr_result(
    document_id: int,
    request: OcrApplyRequest,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Apply new OCR content to a document."""
    print(f"[OCR] Request to apply result for doc {document_id}")
    try:
        service = get_ocr_service()
        result = await service.apply_ocr_result(
            client, document_id, request.content, request.set_finish_tag
        )
        print(f"[OCR] Successfully applied result for doc {document_id}")
        return result
    except Exception as e:
        print(f"[OCR] Error applying result for doc {document_id}: {e}")
        logger.error(f"Error applying result: {e}")
        raise HTTPException(status_code=500, detail=f"Fehler beim Übertragen: {str(e)}")


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
