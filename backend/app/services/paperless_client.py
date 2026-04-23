"""Paperless-ngx API Client."""

import httpx
import asyncio
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import PaperlessSettings
from app.services.cache import get_cache

# Cache TTL in seconds (30 minutes - tags/correspondents change rarely)
CACHE_TTL = 1800


class PaperlessClient:
    """Client for interacting with Paperless-ngx API."""
    
    def __init__(self, base_url: str = "", api_token: str = ""):
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.api_token = api_token
        self.headers = {
            "Authorization": f"Token {api_token}",
            "Content-Type": "application/json"
        } if api_token else {}
    
    async def _request(
        self, 
        method: str, 
        endpoint: str, 
        params: Dict = None,
        json: Dict = None
    ) -> Optional[Dict]:
        """Make an API request to Paperless."""
        if not self.base_url:
            raise ValueError("Paperless URL not configured")
        
        url = f"{self.base_url}/api{endpoint}"
        
        import logging as _log
        import asyncio
        _logger = _log.getLogger(__name__)
        # Retry auf transiente Fehler (Timeout, Connection, 502/503/504/521/522/524).
        # Nur für idempotente Methoden (GET), POST/PUT/PATCH/DELETE retryen wir nicht automatisch.
        retry_statuses = {502, 503, 504, 521, 522, 524}
        max_attempts = 3 if method.upper() == "GET" else 1
        last_exc = None
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True, verify=False) as client:
            for attempt in range(1, max_attempts + 1):
                try:
                    response = await client.request(
                        method=method,
                        url=url,
                        headers=self.headers,
                        params=params,
                        json=json
                    )
                except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as e:
                    last_exc = e
                    if attempt < max_attempts:
                        wait = 5 * attempt
                        _logger.warning(
                            f"Paperless {method} {endpoint} {type(e).__name__} "
                            f"(Versuch {attempt}/{max_attempts}) – Retry in {wait}s"
                        )
                        await asyncio.sleep(wait)
                        continue
                    raise

                if response.status_code in retry_statuses and attempt < max_attempts:
                    wait = 5 * attempt
                    _logger.warning(
                        f"Paperless {method} {endpoint} HTTP {response.status_code} "
                        f"(Versuch {attempt}/{max_attempts}) – Retry in {wait}s"
                    )
                    await asyncio.sleep(wait)
                    continue

                if not response.is_success:
                    try:
                        err_body = response.json()
                    except Exception:
                        err_body = response.text[:500]
                    _logger.error(
                        f"Paperless API error {response.status_code} for {method} {endpoint}: {err_body}"
                    )
                    response.raise_for_status()

                # DELETE requests often return 204 No Content
                if response.status_code == 204 or not response.content:
                    return None

                return response.json()

            # sollte nie erreicht werden, Absicherung
            if last_exc:
                raise last_exc
            return None
    
    async def test_connection(self) -> bool:
        """Test if connection to Paperless is working."""
        if not self.base_url or not self.api_token:
            return False
        try:
            # Try to access API root
            await self._request("GET", "/")
            return True
        except Exception:
            # Try correspondents as alternative
            try:
                result = await self._request("GET", "/correspondents/", params={"page_size": 1})
                return "results" in result or "count" in result
            except Exception:
                return False
    
    # Correspondents
    async def get_correspondents(self, use_cache: bool = True) -> List[Dict]:
        """Get all correspondents."""
        cache = get_cache()
        cache_key = f"paperless:correspondents:{self.base_url}"
        
        if use_cache:
            cached = await cache.get(cache_key)
            if cached is not None:
                return cached
        
        result = await self._request("GET", "/correspondents/", params={"page_size": 10000})
        data = result.get("results", []) if result else []
        
        await cache.set(cache_key, data, CACHE_TTL)
        return data
    
    async def get_correspondents_with_counts(self, use_cache: bool = True) -> List[Dict]:
        """Get correspondents with document counts."""
        correspondents = await self.get_correspondents(use_cache)
        for c in correspondents:
            c["document_count"] = c.get("document_count", 0)
        return correspondents
    
    async def update_correspondent(self, correspondent_id: int, data: Dict) -> Dict:
        """Update a correspondent."""
        return await self._request("PATCH", f"/correspondents/{correspondent_id}/", json=data)
    
    async def delete_correspondent(self, correspondent_id: int) -> None:
        """Delete a correspondent."""
        await self._request("DELETE", f"/correspondents/{correspondent_id}/")
        # Invalidate cache
        cache = get_cache()
        await cache.clear(f"paperless:correspondents:")
    
    # Tags
    async def get_tags(self, use_cache: bool = True) -> List[Dict]:
        """Get all tags."""
        cache = get_cache()
        cache_key = f"paperless:tags:{self.base_url}"
        
        if use_cache:
            cached = await cache.get(cache_key)
            if cached is not None:
                return cached
        
        result = await self._request("GET", "/tags/", params={"page_size": 10000})
        data = result.get("results", []) if result else []
        
        await cache.set(cache_key, data, CACHE_TTL)
        return data
    
    async def get_tags_with_counts(self, use_cache: bool = True) -> List[Dict]:
        """Get tags with document counts."""
        tags = await self.get_tags(use_cache)
        for t in tags:
            t["document_count"] = t.get("document_count", 0)
        return tags
    
    async def update_tag(self, tag_id: int, data: Dict) -> Dict:
        """Update a tag."""
        return await self._request("PATCH", f"/tags/{tag_id}/", json=data)
    
    async def delete_tag(self, tag_id: int) -> None:
        """Delete a tag."""
        await self._request("DELETE", f"/tags/{tag_id}/")
        cache = get_cache()
        await cache.clear(f"paperless:tags:")
    
    async def delete_tags_bulk(self, tag_ids: List[int]) -> dict:
        """Delete multiple tags in parallel batches for maximum performance."""
        if not self.base_url:
            raise ValueError("Paperless URL not configured")
        
        deleted = []
        errors = []
        cache = get_cache()
        CONCURRENT = 3   # low concurrency - Paperless DB can't handle more without timeouts
        TIMEOUT = 60.0   # 60s per request - tag deletion updates documents and can be slow
        
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=TIMEOUT, write=10.0, pool=5.0),
            follow_redirects=True, verify=False
        ) as client:
            async def delete_one(tag_id: int):
                for attempt in range(2):  # 1 retry on timeout
                    try:
                        url = f"{self.base_url}/api/tags/{tag_id}/"
                        response = await client.request("DELETE", url, headers=self.headers)
                        if response.status_code in (404, 204, 200, 201):
                            return tag_id, None
                        response.raise_for_status()
                        return tag_id, None
                    except httpx.TimeoutException:
                        if attempt == 0:
                            await asyncio.sleep(1)
                            continue
                        logger.warning(f"Tag {tag_id}: timeout after retry")
                        return None, {"tag_id": tag_id, "error": "timeout"}
                    except Exception as e:
                        logger.warning(f"Tag {tag_id}: {type(e).__name__}: {e}")
                        return None, {"tag_id": tag_id, "error": str(e) or type(e).__name__}
                return None, {"tag_id": tag_id, "error": "unknown"}
            
            for i in range(0, len(tag_ids), CONCURRENT):
                batch = tag_ids[i:i + CONCURRENT]
                results = await asyncio.gather(*[delete_one(tid) for tid in batch])
                for tag_id, error in results:
                    if tag_id is not None:
                        deleted.append(tag_id)
                    elif error:
                        errors.append(error)
        
        if errors:
            logger.info(f"Bulk delete: {len(deleted)} OK, {len(errors)} failed")
        
        # Smart cache update: remove deleted IDs instead of clearing the whole cache
        # This avoids a slow re-fetch from Paperless on the next request
        cache_key = f"paperless:tags:{self.base_url}"
        existing = await cache.get(cache_key)
        if existing:
            deleted_set = set(deleted)
            updated = [t for t in existing if t.get("id") not in deleted_set]
            await cache.set(cache_key, updated, CACHE_TTL)
        else:
            await cache.clear(f"paperless:tags:")
        
        return {"deleted": deleted, "deleted_count": len(deleted), "errors": errors, "base_url": self.base_url}
    
    # Document Types
    async def get_document_types(self, use_cache: bool = True) -> List[Dict]:
        """Get all document types."""
        cache = get_cache()
        cache_key = f"paperless:document_types:{self.base_url}"
        
        if use_cache:
            cached = await cache.get(cache_key)
            if cached is not None:
                return cached
        
        result = await self._request("GET", "/document_types/", params={"page_size": 10000})
        data = result.get("results", []) if result else []
        
        await cache.set(cache_key, data, CACHE_TTL)
        return data
    
    async def get_document_types_with_counts(self, use_cache: bool = True) -> List[Dict]:
        """Get document types with document counts."""
        doc_types = await self.get_document_types(use_cache)
        for dt in doc_types:
            dt["document_count"] = dt.get("document_count", 0)
        return doc_types
    
    async def update_document_type(self, doc_type_id: int, data: Dict) -> Dict:
        """Update a document type."""
        return await self._request("PATCH", f"/document_types/{doc_type_id}/", json=data)
    
    async def delete_document_type(self, doc_type_id: int) -> None:
        """Delete a document type."""
        await self._request("DELETE", f"/document_types/{doc_type_id}/")
        # Invalidate cache
        cache = get_cache()
        await cache.clear(f"paperless:document_types:")
    
    # Documents
    async def get_documents(
        self,
        correspondent_id: int = None,
        tag_id: int = None,
        document_type_id: int = None,
        query: str = None,
        page_size: int = 250  # 500 reicht gefährlich nah an 120s heran, 250 antwortet stabil in ~50s
    ) -> List[Dict]:
        """Get documents with optional filters and auto-pagination."""
        params = {"page_size": page_size}
        
        if correspondent_id:
            params["correspondent__id"] = correspondent_id
        if tag_id:
            params["tags__id__in"] = tag_id
        if document_type_id:
            params["document_type__id"] = document_type_id
        if query:
            params["query"] = query
        
        all_results = []
        endpoint = "/documents/"
        
        while endpoint:
            result = await self._request("GET", endpoint, params=params)
            if not result:
                break
                
            all_results.extend(result.get("results", []))
            next_url = result.get("next")
            
            if next_url and "/api" in next_url:
                endpoint = next_url.split("/api", 1)[1]
                params = None # The next_url includes all pagination parameters
            else:
                endpoint = None
                
        return all_results
    
    async def get_document_count(
        self,
        tag_id: int = None,
        tags_id_all: List[int] = None,
        tags_id_none: List[int] = None
    ) -> int:
        """Get document count without downloading all documents. Very fast."""
        params = {"page_size": 1}
        if tag_id:
            params["tags__id__in"] = tag_id
        if tags_id_all:
            params["tags__id__all"] = ",".join(str(t) for t in tags_id_all)
        if tags_id_none:
            params["tags__id__none"] = ",".join(str(t) for t in tags_id_none)
        
        result = await self._request("GET", "/documents/", params=params)
        return result.get("count", 0) if result else 0

    async def get_documents_by_correspondent(self, correspondent_id: int) -> List[Dict]:
        """Get all documents for a specific correspondent."""
        return await self.get_documents(correspondent_id=correspondent_id)
    
    async def get_documents_by_tag(self, tag_id: int) -> List[Dict]:
        """Get all documents with a specific tag."""
        return await self.get_documents(tag_id=tag_id)
    
    async def get_documents_by_document_type(self, doc_type_id: int) -> List[Dict]:
        """Get all documents of a specific type."""
        return await self.get_documents(document_type_id=doc_type_id)
    
    async def delete_document(self, document_id: int) -> None:
        """Delete a document."""
        await self._request("DELETE", f"/documents/{document_id}/")

    async def update_document(self, document_id: int, data: Dict) -> Dict:
        """Update a document."""
        return await self._request("PATCH", f"/documents/{document_id}/", json=data)
    
    async def bulk_update_documents(
        self, 
        document_ids: List[int], 
        correspondent_id: int = None,
        add_tags: List[int] = None,
        remove_tags: List[int] = None,
        document_type_id: int = None
    ) -> Dict:
        """Bulk update multiple documents via Paperless bulk_edit API."""
        if add_tags or remove_tags:
            data = {
                "documents": document_ids,
                "method": "modify_tags",
                "parameters": {
                    "add_tags": add_tags or [],
                    "remove_tags": remove_tags or []
                }
            }
        elif correspondent_id is not None:
            data = {
                "documents": document_ids,
                "method": "set_correspondent",
                "parameters": {"correspondent": correspondent_id}
            }
        elif document_type_id is not None:
            data = {
                "documents": document_ids,
                "method": "set_document_type",
                "parameters": {"document_type": document_type_id}
            }
        else:
            return {}
        
        return await self._request("POST", "/documents/bulk_edit/", json=data)
    
    async def get_document_previews(
        self,
        correspondent_id: int = None,
        tag_id: int = None,
        document_type_id: int = None,
        limit: int = 5
    ) -> List[Dict]:
        """Get document previews with thumbnail URLs for a specific entity."""
        params = {"page_size": limit}
        
        if correspondent_id:
            params["correspondent__id"] = correspondent_id
        if tag_id:
            params["tags__id__in"] = tag_id
        if document_type_id:
            params["document_type__id"] = document_type_id
        
        result = await self._request("GET", "/documents/", params=params)
        documents = result.get("results", []) if result else []
        
        # Return simplified preview data with URLs
        previews = []
        for doc in documents:
            previews.append({
                "id": doc.get("id"),
                "title": doc.get("title", "Unbekannt"),
                "created": doc.get("created"),
                "thumbnail_url": f"{self.base_url}/api/documents/{doc.get('id')}/thumb/",
                "document_url": f"{self.base_url}/documents/{doc.get('id')}/",
                "download_url": f"{self.base_url}/api/documents/{doc.get('id')}/download/"
            })
        
        return previews
    
    def get_thumbnail_url(self, document_id: int) -> str:
        """Get thumbnail URL for a document."""
        return f"{self.base_url}/api/documents/{document_id}/thumb/"
    
    def get_document_view_url(self, document_id: int) -> str:
        """Get URL to view document in Paperless UI."""
        return f"{self.base_url}/documents/{document_id}/"
    
    # OCR-related methods
    async def get_document(self, document_id: int) -> Optional[Dict]:
        """Get a single document by ID."""
        return await self._request("GET", f"/documents/{document_id}/")
    
    async def download_document_file(self, document_id: int) -> bytes:
        """Download the original document file as bytes."""
        if not self.base_url:
            raise ValueError("Paperless URL not configured")
        
        url = f"{self.base_url}/api/documents/{document_id}/download/"
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True, verify=False) as client:
            response = await client.get(url, headers={"Authorization": f"Token {self.api_token}"})
            response.raise_for_status()
            return response.content
    
    async def get_document_thumbnail_bytes(self, document_id: int) -> bytes:
        """Download thumbnail image as bytes."""
        if not self.base_url:
            raise ValueError("Paperless URL not configured")
        
        url = f"{self.base_url}/api/documents/{document_id}/thumb/"
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True, verify=False) as client:
            response = await client.get(url, headers={"Authorization": f"Token {self.api_token}"})
            response.raise_for_status()
            return response.content
    
    async def get_document_preview_image(self, document_id: int) -> bytes:
        """Download preview/full image of the document as bytes."""
        if not self.base_url:
            raise ValueError("Paperless URL not configured")
        
        url = f"{self.base_url}/api/documents/{document_id}/preview/"
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True, verify=False) as client:
            response = await client.get(url, headers={"Authorization": f"Token {self.api_token}"})
            response.raise_for_status()
            return response.content

    # Custom Fields
    async def get_custom_fields(self, use_cache: bool = True) -> List[Dict]:
        """Get all custom field definitions from Paperless."""
        cache = get_cache()
        cache_key = f"paperless:custom_fields:{self.base_url}"

        if use_cache:
            cached = await cache.get(cache_key)
            if cached:
                return cached

        all_fields = []
        page = 1
        while True:
            result = await self._request("GET", "/custom_fields/", params={"page": page, "page_size": 100})
            if not result:
                break
            all_fields.extend(result.get("results", []))
            if not result.get("next"):
                break
            page += 1

        await cache.set(cache_key, all_fields, ttl_seconds=CACHE_TTL)
        return all_fields

    # Storage Paths
    async def get_storage_paths(self, use_cache: bool = True) -> List[Dict]:
        """Get all storage paths from Paperless."""
        cache = get_cache()
        cache_key = f"paperless:storage_paths:{self.base_url}"

        if use_cache:
            cached = await cache.get(cache_key)
            if cached:
                return cached

        all_paths = []
        page = 1
        while True:
            result = await self._request("GET", "/storage_paths/", params={"page": page, "page_size": 100})
            if not result:
                break
            all_paths.extend(result.get("results", []))
            if not result.get("next"):
                break
            page += 1

        await cache.set(cache_key, all_paths, ttl_seconds=CACHE_TTL)
        return all_paths

    # Correspondent creation
    async def create_correspondent(self, name: str) -> Dict:
        """Create a new correspondent in Paperless."""
        result = await self._request("POST", "/correspondents/", json={"name": name})
        cache = get_cache()
        await cache.clear("paperless:correspondents:")
        return result

    async def get_or_create_correspondent(self, name: str) -> Dict:
        """Get correspondent by name or create if not found."""
        correspondents = await self.get_correspondents(use_cache=True)
        for c in correspondents:
            if c.get("name", "").lower() == name.lower():
                return c

        correspondents = await self.get_correspondents(use_cache=False)
        for c in correspondents:
            if c.get("name", "").lower() == name.lower():
                return c

        return await self.create_correspondent(name)

    async def create_tag(self, name: str) -> Dict:
        """Create a new tag in Paperless."""
        result = await self._request("POST", "/tags/", json={"name": name})
        # Invalidate tag cache
        cache = get_cache()
        await cache.clear("paperless:tags:")
        return result
    
    async def get_or_create_tag(self, name: str) -> Dict:
        """Get tag by name or create it if it doesn't exist. Uses cache first."""
        # Try cache first (fast path)
        tags = await self.get_tags(use_cache=True)
        for tag in tags:
            if tag.get("name", "").lower() == name.lower():
                return tag
        
        # Not in cache? Refresh and try again (tag might have been created externally)
        tags = await self.get_tags(use_cache=False)
        for tag in tags:
            if tag.get("name", "").lower() == name.lower():
                return tag
        
        # Still not found? Create it
        return await self.create_tag(name)
    
    async def add_tag_to_document(self, document_id: int, tag_id: int) -> Dict:
        """Add a tag to a document."""
        doc = await self.get_document(document_id)
        if doc:
            current_tags = doc.get("tags", [])
            if tag_id not in current_tags:
                current_tags.append(tag_id)
                return await self.update_document(document_id, {"tags": current_tags})
        return doc
    
    async def remove_tag_from_document(self, document_id: int, tag_id: int) -> Dict:
        """Remove a tag from a document."""
        doc = await self.get_document(document_id)
        if doc:
            current_tags = doc.get("tags", [])
            if tag_id in current_tags:
                current_tags.remove(tag_id)
                return await self.update_document(document_id, {"tags": current_tags})
        return doc

    async def upload_document(
        self,
        file_bytes: bytes,
        filename: str,
        correspondent_id: Optional[int] = None,
        document_type_id: Optional[int] = None,
        tag_ids: Optional[List[int]] = None,
    ) -> str:
        """Upload a document to Paperless via post_document. Returns task ID."""
        if not self.base_url:
            raise ValueError("Paperless-URL nicht konfiguriert")

        url = f"{self.base_url}/api/documents/post_document/"

        # Multipart: tags must be repeated fields, not a list in one field
        files_payload = [("document", (filename, file_bytes, "application/octet-stream"))]
        if tag_ids:
            for tid in tag_ids:
                files_payload.append(("tags", (None, str(tid))))

        data: Dict = {}
        if correspondent_id:
            data["correspondent"] = str(correspondent_id)
        if document_type_id:
            data["document_type"] = str(document_type_id)

        async with httpx.AsyncClient(timeout=120.0, verify=False) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Token {self.api_token}"},
                files=files_payload,
                data=data,
            )
            response.raise_for_status()
            return response.text  # returns task ID string


async def get_paperless_client(db: AsyncSession = Depends(get_db)) -> PaperlessClient:
    """Dependency to get configured Paperless client."""
    result = await db.execute(select(PaperlessSettings).where(PaperlessSettings.id == 1))
    settings = result.scalar_one_or_none()
    
    if settings and settings.is_configured:
        return PaperlessClient(
            base_url=settings.url,
            api_token=settings.api_token
        )
    
    return PaperlessClient()

