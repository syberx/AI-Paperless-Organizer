"""Paperless-ngx API Client."""

import httpx
from typing import Optional, List, Dict, Any
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import PaperlessSettings
from app.services.cache import get_cache

# Cache TTL in seconds (10 minutes for lists, they change rarely)
CACHE_TTL = 600


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
        
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True, verify=False) as client:
            response = await client.request(
                method=method,
                url=url,
                headers=self.headers,
                params=params,
                json=json
            )
            response.raise_for_status()
            
            # DELETE requests often return 204 No Content
            if response.status_code == 204 or not response.content:
                return None
            
            return response.json()
    
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
        # Invalidate cache
        cache = get_cache()
        await cache.clear(f"paperless:tags:")
    
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
        page_size: int = 10000
    ) -> List[Dict]:
        """Get documents with optional filters."""
        params = {"page_size": page_size}
        
        if correspondent_id:
            params["correspondent__id"] = correspondent_id
        if tag_id:
            params["tags__id__in"] = tag_id
        if document_type_id:
            params["document_type__id"] = document_type_id
        if query:
            params["query"] = query
        
        result = await self._request("GET", "/documents/", params=params)
        return result.get("results", []) if result else []
    
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
        """Bulk update multiple documents."""
        data = {
            "documents": document_ids,
            "method": "modify_tags" if add_tags or remove_tags else "set_correspondent"
        }
        
        if correspondent_id is not None:
            data["correspondent"] = correspondent_id
        if document_type_id is not None:
            data["document_type"] = document_type_id
        if add_tags:
            data["add_tags"] = add_tags
        if remove_tags:
            data["remove_tags"] = remove_tags
        
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

