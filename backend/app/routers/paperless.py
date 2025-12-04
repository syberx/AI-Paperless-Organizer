from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import PaperlessCache
from app.services.paperless_client import PaperlessClient, get_paperless_client
from app.services.cache import get_cache

router = APIRouter()


async def update_db_cache(db: AsyncSession, key: str, data: list):
    """Update the persistent DB cache."""
    result = await db.execute(
        select(PaperlessCache).where(PaperlessCache.cache_key == key)
    )
    cache_entry = result.scalar_one_or_none()
    
    if cache_entry:
        cache_entry.data = data
        cache_entry.count = len(data)
    else:
        cache_entry = PaperlessCache(
            cache_key=key,
            data=data,
            count=len(data)
        )
        db.add(cache_entry)
    
    await db.commit()


@router.get("/status")
async def get_paperless_status(
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Check connection status to Paperless-ngx - FAST, no data loading."""
    if not client.base_url:
        return {
            "connected": False,
            "error": "Keine URL konfiguriert"
        }
    
    try:
        # Quick connection test only - don't fetch all data!
        is_connected = await client.test_connection()
        return {
            "connected": is_connected,
            "url": client.base_url
        }
    except Exception as e:
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
async def refresh_cache(
    client: PaperlessClient = Depends(get_paperless_client),
    db: AsyncSession = Depends(get_db)
):
    """Refresh the cache by fetching fresh data from Paperless and storing in DB."""
    cache = get_cache()
    
    # Clear in-memory cache
    await cache.clear("paperless:")
    
    # Fetch fresh data from Paperless
    correspondents = await client.get_correspondents(use_cache=False)
    tags = await client.get_tags(use_cache=False)
    doc_types = await client.get_document_types(use_cache=False)
    
    # Store in persistent DB cache for fast dashboard loading
    await update_db_cache(db, 'correspondents', correspondents)
    await update_db_cache(db, 'tags', tags)
    await update_db_cache(db, 'document_types', doc_types)
    
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

