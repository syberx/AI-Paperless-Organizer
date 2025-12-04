from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.paperless_client import PaperlessClient, get_paperless_client
from app.services.cache import get_cache

router = APIRouter()


@router.get("/status")
async def get_paperless_status(client: PaperlessClient = Depends(get_paperless_client)):
    """Check connection status to Paperless-ngx."""
    if not client.base_url:
        return {
            "connected": False,
            "error": "Keine URL konfiguriert"
        }
    
    try:
        # Try to get correspondents as a real API test
        correspondents = await client.get_correspondents()
        return {
            "connected": True,
            "url": client.base_url,
            "correspondents_count": len(correspondents)
        }
    except Exception as e:
        # Fallback to simple connection test
        try:
            is_connected = await client.test_connection()
            if is_connected:
                return {
                    "connected": True,
                    "url": client.base_url
                }
        except:
            pass
        
        return {
            "connected": False,
            "url": client.base_url,
            "error": str(e)
        }


@router.get("/correspondents")
async def get_correspondents(client: PaperlessClient = Depends(get_paperless_client)):
    """Get all correspondents from Paperless."""
    return await client.get_correspondents()


@router.get("/tags")
async def get_tags(client: PaperlessClient = Depends(get_paperless_client)):
    """Get all tags from Paperless."""
    return await client.get_tags()


@router.get("/document-types")
async def get_document_types(client: PaperlessClient = Depends(get_paperless_client)):
    """Get all document types from Paperless."""
    return await client.get_document_types()


@router.get("/documents")
async def get_documents(
    correspondent_id: int = None,
    tag_id: int = None,
    document_type_id: int = None,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Get documents with optional filters."""
    return await client.get_documents(
        correspondent_id=correspondent_id,
        tag_id=tag_id,
        document_type_id=document_type_id
    )


@router.post("/refresh-cache")
async def refresh_cache(client: PaperlessClient = Depends(get_paperless_client)):
    """Refresh the cache by fetching fresh data from Paperless."""
    cache = get_cache()
    
    # Clear all Paperless cache
    await cache.clear("paperless:")
    
    # Fetch fresh data
    correspondents = await client.get_correspondents(use_cache=False)
    tags = await client.get_tags(use_cache=False)
    doc_types = await client.get_document_types(use_cache=False)
    
    return {
        "success": True,
        "correspondents": len(correspondents),
        "tags": len(tags),
        "document_types": len(doc_types),
        "message": "Cache aktualisiert"
    }


@router.get("/document-previews")
async def get_document_previews(
    correspondent_id: int = None,
    tag_id: int = None,
    document_type_id: int = None,
    limit: int = 5,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Get document previews for a specific entity."""
    return await client.get_document_previews(
        correspondent_id=correspondent_id,
        tag_id=tag_id,
        document_type_id=document_type_id,
        limit=limit
    )

