import asyncio
import json
import logging
import os
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_cloud_sync_state: Dict = {
    "enabled": False,
    "running": False,
    "current_source_id": None,
    "current_source_name": None,
    "current_file": None,
    "task": None,
    "last_run": None,
    "files_imported_session": 0,
    "errors_session": 0,
}

_VALID_EXTENSIONS = {
    "pdf", "png", "jpg", "jpeg", "tiff", "tif", "heic",
    "docx", "doc", "odt", "txt", "eml",
}


def get_cloud_sync_state() -> Dict:
    return _cloud_sync_state


class CloudImportService:

    # ── WebDAV ──────────────────────────────────────────────────────────────

    async def list_files_webdav(self, source) -> List[Dict]:
        base_url = source.webdav_url.rstrip("/")
        path = source.webdav_path or "/"
        if not path.startswith("/"):
            path = "/" + path

        url = base_url + path
        auth = (source.webdav_username, source.webdav_password) if source.webdav_username else None

        body = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<propfind xmlns="DAV:"><prop>'
            "<resourcetype/><getcontenttype/><getcontentlength/><getlastmodified/>"
            "</prop></propfind>"
        )

        async with httpx.AsyncClient(timeout=30.0, verify=False, auth=auth) as client:
            response = await client.request(
                "PROPFIND",
                url,
                content=body.encode(),
                headers={"Depth": "1", "Content-Type": "application/xml"},
            )
            response.raise_for_status()

        return self._parse_propfind(response.text)

    def _parse_propfind(self, xml_text: str) -> List[Dict]:
        files = []
        try:
            root = ET.fromstring(xml_text)
            ns = {"d": "DAV:"}
            for resp in root.findall(".//d:response", ns):
                href_el = resp.find("d:href", ns)
                if href_el is None:
                    continue
                href = href_el.text or ""

                # Skip directories
                rt = resp.find(".//d:resourcetype", ns)
                if rt is not None and rt.find("d:collection", ns) is not None:
                    continue

                name = href.rstrip("/").split("/")[-1]
                if not name:
                    continue
                ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
                if ext not in _VALID_EXTENSIONS:
                    continue

                size_el = resp.find(".//d:getcontentlength", ns)
                mod_el = resp.find(".//d:getlastmodified", ns)
                files.append({
                    "path": href,
                    "name": name,
                    "size": int(size_el.text) if size_el is not None and size_el.text else 0,
                    "modified": mod_el.text if mod_el is not None else "",
                })
        except Exception as e:
            logger.error(f"WebDAV PROPFIND parse error: {e}")
        return files

    async def download_file_webdav(self, source, file_path: str) -> bytes:
        base_url = source.webdav_url.rstrip("/")
        if file_path.startswith("http"):
            url = file_path
        elif file_path.startswith("/"):
            url = base_url + file_path
        else:
            base_path = (source.webdav_path or "/").rstrip("/")
            url = base_url + base_path + "/" + file_path

        auth = (source.webdav_username, source.webdav_password) if source.webdav_username else None
        async with httpx.AsyncClient(timeout=120.0, verify=False, auth=auth) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.content

    async def delete_file_webdav(self, source, file_path: str):
        base_url = source.webdav_url.rstrip("/")
        if file_path.startswith("http"):
            url = file_path
        elif file_path.startswith("/"):
            url = base_url + file_path
        else:
            base_path = (source.webdav_path or "/").rstrip("/")
            url = base_url + base_path + "/" + file_path

        auth = (source.webdav_username, source.webdav_password) if source.webdav_username else None
        async with httpx.AsyncClient(timeout=30.0, verify=False, auth=auth) as client:
            r = await client.delete(url)
            r.raise_for_status()

    # ── rclone ──────────────────────────────────────────────────────────────

    def _rclone_conf_path(self, source) -> str:
        conf_dir = "/app/data/rclone"
        os.makedirs(conf_dir, exist_ok=True)
        path = f"{conf_dir}/source_{source.id}.conf"
        if source.rclone_config:
            with open(path, "w") as f:
                f.write(source.rclone_config)
        return path

    async def list_files_rclone(self, source) -> List[Dict]:
        conf = self._rclone_conf_path(source)
        remote = f"{source.rclone_remote}:{source.rclone_path or '/'}"
        proc = await asyncio.create_subprocess_exec(
            "rclone", "lsjson", remote, "--max-depth", "1", "--config", conf,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60.0)
        if proc.returncode != 0:
            raise RuntimeError(f"rclone lsjson failed: {stderr.decode()}")

        items = json.loads(stdout.decode())
        files = []
        for item in items:
            if item.get("IsDir"):
                continue
            name = item.get("Name", "")
            ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
            if ext not in _VALID_EXTENSIONS:
                continue
            files.append({
                "path": item.get("Path", name),
                "name": name,
                "size": item.get("Size", 0),
                "modified": item.get("ModTime", ""),
            })
        return files

    async def download_file_rclone(self, source, file_name: str) -> bytes:
        conf = self._rclone_conf_path(source)
        remote_base = (source.rclone_path or "/").rstrip("/")
        remote = f"{source.rclone_remote}:{remote_base}/{file_name}"
        ext = os.path.splitext(file_name)[1]

        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name

        try:
            proc = await asyncio.create_subprocess_exec(
                "rclone", "copyto", remote, tmp_path, "--config", conf,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120.0)
            if proc.returncode != 0:
                raise RuntimeError(f"rclone copyto failed: {stderr.decode()}")
            with open(tmp_path, "rb") as f:
                return f.read()
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    async def list_folders_rclone(self, source, path: str = "/") -> List[Dict]:
        """List folders on an rclone remote for folder browser."""
        conf = self._rclone_conf_path(source)
        remote = f"{source.rclone_remote}:{path}"
        proc = await asyncio.create_subprocess_exec(
            "rclone", "lsjson", remote, "--dirs-only", "--max-depth", "1", "--config", conf,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)
        if proc.returncode != 0:
            raise RuntimeError(f"rclone lsjson failed: {stderr.decode()}")
        items = json.loads(stdout.decode())
        folders = []
        for item in items:
            if item.get("IsDir"):
                name = item.get("Name", "")
                folder_path = path.rstrip("/") + "/" + name
                folders.append({"name": name, "path": folder_path})
        folders.sort(key=lambda x: x["name"].lower())
        return folders

    async def list_folders_webdav(self, source, path: str = "/") -> List[Dict]:
        """List folders on WebDAV for folder browser."""
        base_url = source.webdav_url.rstrip("/")
        if not path.startswith("/"):
            path = "/" + path
        url = base_url + path
        auth = (source.webdav_username, source.webdav_password) if source.webdav_username else None
        body = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
        )
        async with httpx.AsyncClient(timeout=30.0, verify=False, auth=auth) as client:
            response = await client.request(
                "PROPFIND", url, content=body.encode(),
                headers={"Depth": "1", "Content-Type": "application/xml"},
            )
            response.raise_for_status()
        folders = []
        try:
            root = ET.fromstring(response.text)
            ns = {"d": "DAV:"}
            for resp in root.findall(".//d:response", ns):
                href_el = resp.find("d:href", ns)
                if href_el is None:
                    continue
                href = href_el.text or ""
                rt = resp.find(".//d:resourcetype", ns)
                if rt is None or rt.find("d:collection", ns) is None:
                    continue
                name = href.rstrip("/").split("/")[-1]
                if not name or href.rstrip("/") == path.rstrip("/"):
                    continue
                folders.append({"name": name, "path": href.rstrip("/")})
        except Exception as e:
            logger.error(f"WebDAV folder parse error: {e}")
        folders.sort(key=lambda x: x["name"].lower())
        return folders

    async def list_folders_local(self, source, path: str = "/") -> List[Dict]:
        """List folders in a local directory."""
        if not os.path.isdir(path):
            return []
        folders = []
        for entry in os.scandir(path):
            if entry.is_dir():
                folders.append({"name": entry.name, "path": entry.path})
        folders.sort(key=lambda x: x["name"].lower())
        return folders

    async def list_folders(self, source, path: str = "/") -> List[Dict]:
        """List folders on any source type."""
        if source.source_type == "rclone":
            return await self.list_folders_rclone(source, path)
        elif source.source_type == "webdav":
            return await self.list_folders_webdav(source, path)
        elif source.source_type == "local":
            return await self.list_folders_local(source, path)
        return []

    async def delete_file_rclone(self, source, file_name: str):
        conf = self._rclone_conf_path(source)
        remote_base = (source.rclone_path or "/").rstrip("/")
        remote = f"{source.rclone_remote}:{remote_base}/{file_name}"
        proc = await asyncio.create_subprocess_exec(
            "rclone", "deletefile", remote, "--config", conf,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)
        if proc.returncode != 0:
            raise RuntimeError(f"rclone deletefile failed: {stderr.decode()}")

    # ── Local folder ────────────────────────────────────────────────────────

    async def list_files_local(self, source) -> List[Dict]:
        path = source.local_path
        if not path or not os.path.isdir(path):
            raise FileNotFoundError(f"Lokaler Pfad nicht gefunden: {path}")
        files = []
        for entry in os.scandir(path):
            if not entry.is_file():
                continue
            ext = entry.name.lower().rsplit(".", 1)[-1] if "." in entry.name else ""
            if ext not in _VALID_EXTENSIONS:
                continue
            stat = entry.stat()
            files.append({
                "path": entry.path,
                "name": entry.name,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        return files

    # ── Dedup ────────────────────────────────────────────────────────────────

    async def is_already_imported(self, db, source_id: int, file_path: str) -> bool:
        from sqlalchemy import select
        from app.models.cloud_import import CloudImportLog
        result = await db.execute(
            select(CloudImportLog).where(
                CloudImportLog.source_id == source_id,
                CloudImportLog.file_path == file_path,
                CloudImportLog.import_status == "success",
            )
        )
        return result.scalar_one_or_none() is not None

    # ── Sync one source ──────────────────────────────────────────────────────

    async def sync_source(self, source, pl_client, db) -> Dict:
        stats = {"imported": 0, "skipped": 0, "errors": 0}

        if source.source_type == "webdav":
            files = await self.list_files_webdav(source)
        elif source.source_type == "rclone":
            files = await self.list_files_rclone(source)
        elif source.source_type == "local":
            files = await self.list_files_local(source)
        else:
            raise ValueError(f"Unbekannter Quelltyp: {source.source_type}")

        tag_ids = []
        try:
            tag_ids = json.loads(source.paperless_tag_ids or "[]")
        except Exception:
            pass

        for file_info in files:
            if not _cloud_sync_state["enabled"]:
                break

            file_path = file_info["path"]
            file_name = file_info["name"]
            _cloud_sync_state["current_file"] = file_name

            if await self.is_already_imported(db, source.id, file_path):
                stats["skipped"] += 1
                continue

            # Download
            try:
                if source.source_type == "webdav":
                    file_bytes = await self.download_file_webdav(source, file_path)
                elif source.source_type == "rclone":
                    file_bytes = await self.download_file_rclone(source, file_name)
                else:
                    with open(file_path, "rb") as f:
                        file_bytes = f.read()
            except Exception as e:
                logger.error(f"Cloud import: Download fehlgeschlagen für {file_name}: {e}")
                await self._log(db, source, file_path, file_name, None, "error", str(e))
                stats["errors"] += 1
                continue

            # Upload to Paperless
            prefix = source.filename_prefix or ""
            paperless_name = prefix + file_name
            try:
                await pl_client.upload_document(
                    file_bytes=file_bytes,
                    filename=paperless_name,
                    correspondent_id=source.paperless_correspondent_id,
                    document_type_id=source.paperless_document_type_id,
                    tag_ids=tag_ids if tag_ids else None,
                )
                await self._log(db, source, file_path, file_name, None, "success", "")
                stats["imported"] += 1
                source.files_imported = (source.files_imported or 0) + 1
                _cloud_sync_state["files_imported_session"] += 1

                # Post-import action
                if source.after_import_action == "delete":
                    try:
                        if source.source_type == "webdav":
                            await self.delete_file_webdav(source, file_path)
                        elif source.source_type == "rclone":
                            await self.delete_file_rclone(source, file_name)
                        elif source.source_type == "local":
                            os.unlink(file_path)
                    except Exception as e:
                        logger.warning(f"Cloud import: Quelldatei konnte nicht gelöscht werden {file_name}: {e}")

            except Exception as e:
                logger.error(f"Cloud import: Paperless-Upload fehlgeschlagen für {file_name}: {e}")
                await self._log(db, source, file_path, file_name, None, "error", str(e))
                stats["errors"] += 1
                _cloud_sync_state["errors_session"] += 1

        return stats

    async def _log(self, db, source, file_path: str, file_name: str,
                   doc_id: Optional[int], status: str, error: str):
        from app.models.cloud_import import CloudImportLog
        entry = CloudImportLog(
            source_id=source.id,
            source_name=source.name,
            file_path=file_path,
            file_name=file_name,
            paperless_doc_id=doc_id,
            import_status=status,
            error_message=error,
        )
        db.add(entry)
        await db.commit()

    # ── Connection test ──────────────────────────────────────────────────────

    async def test_connection(self, source) -> Dict:
        try:
            if source.source_type == "webdav":
                files = await self.list_files_webdav(source)
            elif source.source_type == "rclone":
                files = await self.list_files_rclone(source)
            elif source.source_type == "local":
                files = await self.list_files_local(source)
            else:
                return {"ok": False, "message": "Unbekannter Quelltyp", "files": 0}
            return {"ok": True, "message": f"Verbindung OK – {len(files)} Dokument(e) gefunden", "files": len(files)}
        except Exception as e:
            return {"ok": False, "message": str(e), "files": 0}


# ── Singleton + polling loop ─────────────────────────────────────────────────

_service = CloudImportService()


def get_cloud_import_service() -> CloudImportService:
    return _service


async def cloud_sync_loop():
    """Polling loop: checks all enabled sources on their configured interval."""
    from app.database import async_session
    from app.models.cloud_import import CloudSource
    from app.models.settings_model import PaperlessSettings
    from app.services.paperless_client import PaperlessClient
    from sqlalchemy import select

    logger.info("Cloud sync loop started")

    while _cloud_sync_state["enabled"]:
        _cloud_sync_state["last_run"] = datetime.utcnow().isoformat()

        try:
            async with async_session() as db:
                pl_q = await db.execute(select(PaperlessSettings).where(PaperlessSettings.id == 1))
                pl_settings = pl_q.scalar_one_or_none()

                if not pl_settings or not pl_settings.is_configured:
                    logger.warning("Cloud sync: Paperless nicht konfiguriert, warte...")
                    await asyncio.sleep(60)
                    continue

                pl_client = PaperlessClient(base_url=pl_settings.url, api_token=pl_settings.api_token)

                src_q = await db.execute(select(CloudSource).where(CloudSource.enabled == True))
                sources = src_q.scalars().all()

                now = datetime.utcnow()
                for source in sources:
                    if not _cloud_sync_state["enabled"]:
                        break

                    # Respect per-source poll interval
                    if source.last_checked_at:
                        elapsed = (now - source.last_checked_at).total_seconds() / 60
                        if elapsed < (source.poll_interval_minutes or 5):
                            continue

                    _cloud_sync_state["running"] = True
                    _cloud_sync_state["current_source_id"] = source.id
                    _cloud_sync_state["current_source_name"] = source.name
                    source.last_status = "syncing"
                    source.last_error = ""
                    await db.commit()

                    try:
                        stats = await _service.sync_source(source, pl_client, db)
                        source.last_status = "idle"
                        source.last_checked_at = datetime.utcnow()
                        logger.info(
                            f"Cloud sync '{source.name}': "
                            f"{stats['imported']} importiert, {stats['skipped']} übersprungen, {stats['errors']} Fehler"
                        )
                    except Exception as e:
                        source.last_status = "error"
                        source.last_error = str(e)
                        source.last_checked_at = datetime.utcnow()
                        logger.error(f"Cloud sync '{source.name}' fehlgeschlagen: {e}")

                    _cloud_sync_state["running"] = False
                    _cloud_sync_state["current_source_id"] = None
                    _cloud_sync_state["current_source_name"] = None
                    _cloud_sync_state["current_file"] = None
                    await db.commit()

        except Exception as e:
            logger.error(f"Cloud sync loop error: {e}")
            _cloud_sync_state["running"] = False

        # Main loop sleeps 60s, per-source interval is checked above
        await asyncio.sleep(60)

    _cloud_sync_state["running"] = False
    logger.info("Cloud sync loop stopped")
