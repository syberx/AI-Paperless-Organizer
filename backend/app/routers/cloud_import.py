import asyncio
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.models.cloud_import import CloudSource, CloudImportLog
from app.services.cloud_import_service import (
    get_cloud_import_service,
    get_cloud_sync_state,
    cloud_sync_loop,
    _cloud_sync_state,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class CloudSourceCreate(BaseModel):
    name: str
    source_type: str = "webdav"  # webdav, rclone, local
    enabled: bool = True
    poll_interval_minutes: int = 5

    # WebDAV
    webdav_url: str = ""
    webdav_username: str = ""
    webdav_password: str = ""
    webdav_path: str = "/"

    # rclone
    rclone_remote: str = ""
    rclone_path: str = "/"
    rclone_config: str = ""

    # Local
    local_path: str = ""

    # Import settings
    filename_prefix: str = ""
    paperless_tag_ids: str = "[]"
    paperless_correspondent_id: Optional[int] = None
    paperless_document_type_id: Optional[int] = None
    after_import_action: str = "keep"  # keep, delete


class CloudSourceUpdate(CloudSourceCreate):
    pass


# ── Source CRUD ──────────────────────────────────────────────────────────────

@router.get("/sources")
async def list_sources(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CloudSource).order_by(CloudSource.id))
    sources = result.scalars().all()
    return [_source_to_dict(s) for s in sources]


@router.post("/sources")
async def create_source(body: CloudSourceCreate, db: AsyncSession = Depends(get_db)):
    source = CloudSource(**body.model_dump())
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return _source_to_dict(source)


@router.put("/sources/{source_id}")
async def update_source(source_id: int, body: CloudSourceUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CloudSource).where(CloudSource.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Quelle nicht gefunden")

    for key, val in body.model_dump().items():
        setattr(source, key, val)
    await db.commit()
    await db.refresh(source)
    return _source_to_dict(source)


@router.delete("/sources/{source_id}")
async def delete_source(source_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CloudSource).where(CloudSource.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Quelle nicht gefunden")
    await db.delete(source)
    await db.commit()
    return {"ok": True}


# ── Connection test ──────────────────────────────────────────────────────────

@router.post("/sources/{source_id}/test")
async def test_source(source_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CloudSource).where(CloudSource.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Quelle nicht gefunden")
    return await get_cloud_import_service().test_connection(source)


# ── Manual sync trigger ──────────────────────────────────────────────────────

@router.post("/sources/{source_id}/sync")
async def sync_source_now(source_id: int, db: AsyncSession = Depends(get_db)):
    from app.models.settings_model import PaperlessSettings
    from app.services.paperless_client import PaperlessClient

    result = await db.execute(select(CloudSource).where(CloudSource.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Quelle nicht gefunden")

    pl_q = await db.execute(select(PaperlessSettings).where(PaperlessSettings.id == 1))
    pl_settings = pl_q.scalar_one_or_none()
    if not pl_settings or not pl_settings.is_configured:
        raise HTTPException(status_code=400, detail="Paperless nicht konfiguriert")

    pl_client = PaperlessClient(base_url=pl_settings.url, api_token=pl_settings.api_token)

    try:
        stats = await get_cloud_import_service().sync_source(source, pl_client, db)
        from datetime import datetime
        source.last_checked_at = datetime.utcnow()
        source.last_status = "idle"
        await db.commit()
        return {"ok": True, **stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Folder browser ───────────────────────────────────────────────────────────

@router.get("/sources/{source_id}/folders")
async def browse_source_folders(source_id: int, path: str = "/", db: AsyncSession = Depends(get_db)):
    """List folders on a source for folder picker UI."""
    result = await db.execute(select(CloudSource).where(CloudSource.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Quelle nicht gefunden")
    try:
        svc = get_cloud_import_service()
        folders = await svc.list_folders(source, path)
        return {"path": path, "folders": folders}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── File listing ─────────────────────────────────────────────────────────────

@router.get("/sources/{source_id}/files")
async def list_source_files(source_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CloudSource).where(CloudSource.id == source_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Quelle nicht gefunden")
    try:
        svc = get_cloud_import_service()
        if source.source_type == "webdav":
            files = await svc.list_files_webdav(source)
        elif source.source_type == "rclone":
            files = await svc.list_files_rclone(source)
        elif source.source_type == "local":
            files = await svc.list_files_local(source)
        else:
            files = []
        return {"files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Import log ───────────────────────────────────────────────────────────────

@router.get("/log")
async def get_import_log(
    source_id: Optional[int] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    query = select(CloudImportLog).order_by(desc(CloudImportLog.imported_at)).limit(limit)
    if source_id is not None:
        query = query.where(CloudImportLog.source_id == source_id)
    result = await db.execute(query)
    logs = result.scalars().all()
    return [
        {
            "id": l.id,
            "source_id": l.source_id,
            "source_name": l.source_name,
            "file_name": l.file_name,
            "file_path": l.file_path,
            "paperless_doc_id": l.paperless_doc_id,
            "import_status": l.import_status,
            "error_message": l.error_message,
            "imported_at": l.imported_at.isoformat() if l.imported_at else None,
        }
        for l in logs
    ]


@router.delete("/log")
async def clear_import_log(source_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import delete
    query = delete(CloudImportLog)
    if source_id is not None:
        query = query.where(CloudImportLog.source_id == source_id)
    await db.execute(query)
    await db.commit()
    return {"ok": True}


# ── Sync daemon control ──────────────────────────────────────────────────────

@router.get("/status")
async def get_sync_status():
    state = get_cloud_sync_state()
    return {
        "enabled": state["enabled"],
        "running": state["running"],
        "current_source_name": state["current_source_name"],
        "current_file": state["current_file"],
        "last_run": state["last_run"],
        "files_imported_session": state["files_imported_session"],
        "errors_session": state["errors_session"],
    }


@router.post("/start")
async def start_sync_daemon():
    if _cloud_sync_state["enabled"]:
        return {"status": "already_running"}
    _cloud_sync_state["enabled"] = True
    _cloud_sync_state["files_imported_session"] = 0
    _cloud_sync_state["errors_session"] = 0
    _cloud_sync_state["task"] = asyncio.get_running_loop().create_task(cloud_sync_loop())
    logger.info("Cloud sync daemon gestartet")
    return {"status": "started"}


@router.post("/stop")
async def stop_sync_daemon():
    _cloud_sync_state["enabled"] = False
    task = _cloud_sync_state.get("task")
    if task and not task.done():
        task.cancel()
    _cloud_sync_state["running"] = False
    logger.info("Cloud sync daemon gestoppt")
    return {"status": "stopped"}


# ── Paperless metadata for dropdowns ────────────────────────────────────────

@router.get("/paperless/tags")
async def get_paperless_tags(db: AsyncSession = Depends(get_db)):
    from app.models.settings_model import PaperlessSettings
    from app.services.paperless_client import PaperlessClient
    pl_q = await db.execute(select(PaperlessSettings).where(PaperlessSettings.id == 1))
    pl_settings = pl_q.scalar_one_or_none()
    if not pl_settings or not pl_settings.is_configured:
        return []
    client = PaperlessClient(base_url=pl_settings.url, api_token=pl_settings.api_token)
    try:
        tags = await client.get_tags(use_cache=False)
        return [{"id": t["id"], "name": t["name"]} for t in tags]
    except Exception:
        return []


@router.get("/paperless/correspondents")
async def get_paperless_correspondents(db: AsyncSession = Depends(get_db)):
    from app.models.settings_model import PaperlessSettings
    from app.services.paperless_client import PaperlessClient
    pl_q = await db.execute(select(PaperlessSettings).where(PaperlessSettings.id == 1))
    pl_settings = pl_q.scalar_one_or_none()
    if not pl_settings or not pl_settings.is_configured:
        return []
    client = PaperlessClient(base_url=pl_settings.url, api_token=pl_settings.api_token)
    try:
        corrs = await client.get_correspondents(use_cache=False)
        return [{"id": c["id"], "name": c["name"]} for c in corrs]
    except Exception:
        return []


@router.get("/paperless/document-types")
async def get_paperless_document_types(db: AsyncSession = Depends(get_db)):
    from app.models.settings_model import PaperlessSettings
    from app.services.paperless_client import PaperlessClient
    pl_q = await db.execute(select(PaperlessSettings).where(PaperlessSettings.id == 1))
    pl_settings = pl_q.scalar_one_or_none()
    if not pl_settings or not pl_settings.is_configured:
        return []
    client = PaperlessClient(base_url=pl_settings.url, api_token=pl_settings.api_token)
    try:
        types = await client.get_document_types(use_cache=False)
        return [{"id": t["id"], "name": t["name"]} for t in types]
    except Exception:
        return []


# ── rclone OAuth flow ────────────────────────────────────────────────────────

_rclone_auth_state: dict = {
    "process": None,
    "proxy_server": None,
    "provider": None,
    "auth_url": None,
    "token": None,
    "status": "idle",  # idle, waiting, success, error
    "error": None,
}

_RCLONE_PROVIDERS = {
    "gdrive": {"rclone_type": "drive", "label": "Google Drive"},
    "onedrive": {"rclone_type": "onedrive", "label": "OneDrive"},
    "dropbox": {"rclone_type": "dropbox", "label": "Dropbox"},
}


async def _cleanup_rclone_auth():
    """Kill running rclone authorize + proxy."""
    if _rclone_auth_state["process"] and _rclone_auth_state["process"].returncode is None:
        try:
            _rclone_auth_state["process"].kill()
            await asyncio.wait_for(_rclone_auth_state["process"].wait(), timeout=3)
        except Exception:
            pass
    if _rclone_auth_state["proxy_server"]:
        try:
            _rclone_auth_state["proxy_server"].close()
            await _rclone_auth_state["proxy_server"].wait_closed()
        except Exception:
            pass
    _rclone_auth_state["process"] = None
    _rclone_auth_state["proxy_server"] = None


async def _tcp_proxy_handler(reader, writer):
    """Forward incoming TCP from 0.0.0.0:53683 → 127.0.0.1:53682 (rclone)."""
    try:
        target_reader, target_writer = await asyncio.open_connection("127.0.0.1", 53682)
    except Exception:
        writer.close()
        return

    async def forward(src, dst):
        try:
            while True:
                data = await src.read(8192)
                if not data:
                    break
                dst.write(data)
                await dst.drain()
        except Exception:
            pass
        finally:
            try:
                dst.close()
            except Exception:
                pass

    await asyncio.gather(forward(reader, target_writer), forward(target_reader, writer))


@router.post("/rclone/authorize")
async def start_rclone_authorize(provider: str = "gdrive"):
    """Start rclone OAuth flow with TCP proxy for Docker."""
    if provider not in _RCLONE_PROVIDERS:
        raise HTTPException(400, f"Unbekannter Provider: {provider}")

    # Kill any previous rclone authorize + proxy
    await _cleanup_rclone_auth()

    # Also kill any orphan rclone on port 53682
    try:
        kill_proc = await asyncio.create_subprocess_exec(
            "fuser", "-k", "53682/tcp",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(kill_proc.wait(), timeout=3)
    except Exception:
        pass
    await asyncio.sleep(0.5)

    rclone_type = _RCLONE_PROVIDERS[provider]["rclone_type"]
    _rclone_auth_state.update({
        "provider": provider,
        "auth_url": None,
        "token": None,
        "status": "waiting",
        "error": None,
        "process": None,
        "proxy_server": None,
    })

    # 1) Start rclone authorize (binds to 127.0.0.1:53682)
    proc = await asyncio.create_subprocess_exec(
        "rclone", "authorize", rclone_type, "--auth-no-open-browser",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _rclone_auth_state["process"] = proc

    # 2) Wait briefly for rclone to bind its port
    await asyncio.sleep(1)

    # 3) Start TCP proxy: 0.0.0.0:53683 → 127.0.0.1:53682
    #    Docker maps host:53682 → container:53683
    try:
        proxy = await asyncio.start_server(_tcp_proxy_handler, "0.0.0.0", 53683)
        _rclone_auth_state["proxy_server"] = proxy
        logger.info("rclone OAuth TCP proxy started on 0.0.0.0:53683 → 127.0.0.1:53682")
    except Exception as e:
        logger.warning(f"rclone OAuth TCP proxy failed: {e}")

    # 4) Read output in background
    asyncio.get_running_loop().create_task(_read_rclone_auth(proc))

    # 5) Wait for URL
    for _ in range(30):
        await asyncio.sleep(0.5)
        if _rclone_auth_state["auth_url"]:
            return {
                "status": "waiting",
                "auth_url": _rclone_auth_state["auth_url"],
                "provider": provider,
                "label": _RCLONE_PROVIDERS[provider]["label"],
            }
        if _rclone_auth_state["status"] == "error":
            return {
                "status": "error",
                "error": _rclone_auth_state["error"],
            }

    return {"status": "waiting", "auth_url": None, "message": "Auth-URL wird geladen…"}


async def _read_rclone_auth(proc):
    """Background: read rclone stdout/stderr, extract auth URL + token."""
    import re

    all_stdout = []

    async def read_stream(stream, name):
        while True:
            line = await stream.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").strip()
            if not text:
                continue
            logger.info(f"rclone {name}: {text}")

            if name == "stdout":
                all_stdout.append(text)

            # Extract auth URL — rclone prints "Please go to the following link: http://..."
            if "go to the following link" in text.lower() or ("http" in text and "/auth?" in text):
                url_match = re.search(r'(https?://\S+)', text)
                if url_match and not _rclone_auth_state["auth_url"]:
                    _rclone_auth_state["auth_url"] = url_match.group(1)
                    logger.info(f"rclone auth URL: {url_match.group(1)[:80]}…")

    await asyncio.gather(
        read_stream(proc.stdout, "stdout"),
        read_stream(proc.stderr, "stderr"),
    )
    await proc.wait()

    # Close proxy
    if _rclone_auth_state["proxy_server"]:
        try:
            _rclone_auth_state["proxy_server"].close()
        except Exception:
            pass

    # Extract token from stdout lines
    token_json = None
    for line in all_stdout:
        line = line.strip()
        if line.startswith("{") and "access_token" in line:
            try:
                json.loads(line)
                token_json = line
                break
            except Exception:
                pass

    if token_json:
        _rclone_auth_state["token"] = token_json
        _rclone_auth_state["status"] = "success"
        logger.info("rclone auth: Token erfasst")
    elif proc.returncode == 0:
        _rclone_auth_state["status"] = "error"
        _rclone_auth_state["error"] = "Token konnte nicht gelesen werden. Bitte erneut versuchen."
    else:
        _rclone_auth_state["status"] = "error"
        _rclone_auth_state["error"] = f"rclone Fehler (exit {proc.returncode})"


@router.get("/rclone/authorize/status")
async def get_rclone_authorize_status():
    """Poll for rclone OAuth status."""
    return {
        "status": _rclone_auth_state["status"],
        "auth_url": _rclone_auth_state["auth_url"],
        "token": _rclone_auth_state["token"],
        "provider": _rclone_auth_state["provider"],
        "error": _rclone_auth_state["error"],
    }


@router.post("/rclone/authorize/create-source")
async def create_source_from_rclone_auth(
    name: str = "Google Drive",
    remote_name: str = "gdrive",
    remote_path: str = "/",
    db: AsyncSession = Depends(get_db),
):
    """Create a CloudSource from a successful rclone authorization."""
    if _rclone_auth_state["status"] != "success" or not _rclone_auth_state["token"]:
        raise HTTPException(400, "Kein gültiger Token vorhanden. Bitte zuerst autorisieren.")

    provider = _rclone_auth_state["provider"] or "gdrive"
    rclone_type = _RCLONE_PROVIDERS.get(provider, {}).get("rclone_type", "drive")

    # Build rclone config
    config_content = f"[{remote_name}]\ntype = {rclone_type}\ntoken = {_rclone_auth_state['token']}\n"

    source = CloudSource(
        name=name,
        source_type="rclone",
        rclone_remote=remote_name,
        rclone_path=remote_path,
        rclone_config=config_content,
        enabled=True,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    # Reset auth state
    _rclone_auth_state.update({"process": None, "status": "idle", "token": None, "auth_url": None})

    return _source_to_dict(source)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _source_to_dict(s: CloudSource) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "source_type": s.source_type,
        "enabled": s.enabled,
        "poll_interval_minutes": s.poll_interval_minutes,
        "webdav_url": s.webdav_url,
        "webdav_username": s.webdav_username,
        "webdav_password": "***" if s.webdav_password else "",
        "webdav_path": s.webdav_path,
        "rclone_remote": s.rclone_remote,
        "rclone_path": s.rclone_path,
        "rclone_config": s.rclone_config,
        "local_path": s.local_path,
        "filename_prefix": s.filename_prefix,
        "paperless_tag_ids": s.paperless_tag_ids,
        "paperless_correspondent_id": s.paperless_correspondent_id,
        "paperless_document_type_id": s.paperless_document_type_id,
        "after_import_action": s.after_import_action,
        "last_checked_at": s.last_checked_at.isoformat() if s.last_checked_at else None,
        "last_status": s.last_status,
        "last_error": s.last_error,
        "files_imported": s.files_imported,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
