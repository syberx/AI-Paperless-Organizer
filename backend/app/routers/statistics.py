"""Statistics API endpoints."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import PaperlessCache
from app.services.statistics import StatisticsService, get_statistics_service
from app.services.paperless_client import PaperlessClient, get_paperless_client

router = APIRouter()


class RecordStatisticRequest(BaseModel):
    """Request to record a statistic."""
    entity_type: str
    operation: str
    items_affected: int
    documents_affected: int = 0


@router.post("/record")
async def record_statistic(
    request: RecordStatisticRequest,
    stats_service: StatisticsService = Depends(get_statistics_service)
):
    """Manually record a cleanup operation statistic."""
    await stats_service.record_operation(
        entity_type=request.entity_type,
        operation=request.operation,
        items_affected=request.items_affected,
        documents_affected=request.documents_affected
    )
    return {"success": True}


async def get_cached_counts(db: AsyncSession, paperless: PaperlessClient) -> dict:
    """Get counts from DB cache, or load from Paperless if cache is empty."""
    import asyncio
    
    result = {}
    cache_empty = False
    
    for key in ['correspondents', 'tags', 'document_types']:
        cache_result = await db.execute(
            select(PaperlessCache).where(PaperlessCache.cache_key == key)
        )
        cache_entry = cache_result.scalar_one_or_none()
        if cache_entry and cache_entry.count > 0:
            result[key] = cache_entry.count
        else:
            cache_empty = True
            result[key] = 0
    
    # If any cache is empty, try to load from Paperless and populate cache
    if cache_empty and paperless.base_url:
        try:
            correspondents, tags, doc_types = await asyncio.gather(
                paperless.get_correspondents(),  # Uses in-memory cache
                paperless.get_tags(),
                paperless.get_document_types()
            )
            result = {
                'correspondents': len(correspondents),
                'tags': len(tags),
                'document_types': len(doc_types)
            }
            # Save to DB cache for next time
            for key, data in [('correspondents', correspondents), ('tags', tags), ('document_types', doc_types)]:
                cache_result = await db.execute(
                    select(PaperlessCache).where(PaperlessCache.cache_key == key)
                )
                cache_entry = cache_result.scalar_one_or_none()
                if cache_entry:
                    cache_entry.data = data
                    cache_entry.count = len(data)
                else:
                    cache_entry = PaperlessCache(cache_key=key, data=data, count=len(data))
                    db.add(cache_entry)
            await db.commit()
        except Exception as e:
            print(f"Error loading from Paperless: {e}")
            # Keep the 0 values if Paperless fails
    
    return result


@router.get("/summary")
async def get_statistics_summary(
    stats_service: StatisticsService = Depends(get_statistics_service),
    paperless: PaperlessClient = Depends(get_paperless_client),
    db: AsyncSession = Depends(get_db)
):
    """Get comprehensive statistics summary for dashboard."""
    import asyncio
    
    # Get cleanup stats and counts in parallel
    cleanup_stats, current_counts = await asyncio.gather(
        stats_service.get_total_stats(),
        get_cached_counts(db, paperless)
    )
    
    total_cleaned = cleanup_stats['total_items_cleaned']
    
    return {
        'current_counts': current_counts,
        'cleanup_stats': cleanup_stats,
        'savings': {
            'total_items_cleaned': total_cleaned,
            'estimated_time_saved_minutes': total_cleaned * 2,
        }
    }


@router.get("/recent")
async def get_recent_operations(
    limit: int = 10,
    stats_service: StatisticsService = Depends(get_statistics_service)
):
    """Get recent cleanup operations."""
    return await stats_service.get_recent_operations(limit)


@router.get("/trend")
async def get_daily_trend(
    days: int = 7,
    stats_service: StatisticsService = Depends(get_statistics_service)
):
    """Get daily statistics trend."""
    return await stats_service.get_daily_trend(days)

