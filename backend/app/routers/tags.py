from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from app.models import SavedAnalysis
from app.services.paperless_client import PaperlessClient, get_paperless_client
from app.services.similarity import SimilarityService, get_similarity_service
from app.services.merge import MergeService, get_merge_service
from app.services.statistics import StatisticsService, get_statistics_service
from app.services.llm_provider import LLMProviderService, get_llm_service

router = APIRouter()
ENTITY_TYPE = "tags"


class MergeRequest(BaseModel):
    """Request to merge tags."""
    target_id: int
    target_name: str
    source_ids: List[int]


class AnalyzeRequest(BaseModel):
    """Request to analyze tags for duplicates."""
    batch_size: int = 200


@router.get("/")
async def list_tags(client: PaperlessClient = Depends(get_paperless_client)):
    """List all tags with document counts."""
    return await client.get_tags_with_counts()


@router.get("/estimate")
async def estimate_tags(
    client: PaperlessClient = Depends(get_paperless_client),
    llm: LLMProviderService = Depends(get_llm_service)
):
    """Estimate tokens needed for analysis."""
    tags = await client.get_tags_with_counts()
    items_count = len(tags)
    avg_name_length = sum(len(t.get("name", "")) for t in tags) / max(items_count, 1)
    estimated_input = 500 + int(items_count * (avg_name_length + 10))
    estimated_tokens = estimated_input // 4
    
    # Get token limit from LLM provider
    token_limit = llm.get_token_limit()
    safe_limit = int(token_limit * 0.8)
    needs_batching = estimated_tokens > safe_limit
    recommended_batches = max(1, (estimated_tokens + safe_limit - 1) // safe_limit) if needs_batching else 1
    
    return {
        "items_count": items_count,
        "estimated_tokens": estimated_tokens,
        "token_limit": token_limit,
        "recommended_batches": recommended_batches,
        "warning": f"Tokens ({estimated_tokens}) > Limit ({safe_limit}). Wird in {recommended_batches} Batches aufgeteilt." if needs_batching else None
    }


@router.get("/saved-analysis")
async def get_saved_analysis(db: AsyncSession = Depends(get_db)):
    """Check if there's a saved analysis."""
    result = await db.execute(
        select(SavedAnalysis)
        .where(SavedAnalysis.entity_type == ENTITY_TYPE)
        .order_by(SavedAnalysis.created_at.desc())
        .limit(1)
    )
    saved = result.scalar_one_or_none()
    
    if saved:
        return {
            "exists": True,
            "id": saved.id,
            "created_at": saved.created_at.isoformat() if saved.created_at else None,
            "items_count": saved.items_count,
            "groups_count": saved.groups_count,
            "processed_groups": saved.processed_groups or []
        }
    return {"exists": False}


@router.get("/saved-analysis/load")
async def load_saved_analysis(db: AsyncSession = Depends(get_db)):
    """Load the saved analysis results."""
    result = await db.execute(
        select(SavedAnalysis)
        .where(SavedAnalysis.entity_type == ENTITY_TYPE)
        .order_by(SavedAnalysis.created_at.desc())
        .limit(1)
    )
    saved = result.scalar_one_or_none()
    
    if not saved:
        raise HTTPException(status_code=404, detail="Keine gespeicherte Analyse gefunden")
    
    return {
        "groups": saved.groups,
        "stats": saved.stats,
        "created_at": saved.created_at.isoformat() if saved.created_at else None,
        "processed_groups": saved.processed_groups or []
    }


@router.delete("/saved-analysis")
async def delete_saved_analysis(db: AsyncSession = Depends(get_db)):
    """Delete saved analysis."""
    await db.execute(delete(SavedAnalysis).where(SavedAnalysis.entity_type == ENTITY_TYPE))
    await db.commit()
    return {"success": True}


@router.post("/saved-analysis/mark-processed")
async def mark_group_processed(
    group_index: int,
    db: AsyncSession = Depends(get_db)
):
    """Mark a group as processed (merged or dismissed)."""
    result = await db.execute(
        select(SavedAnalysis)
        .where(SavedAnalysis.entity_type == ENTITY_TYPE)
        .order_by(SavedAnalysis.created_at.desc())
        .limit(1)
    )
    saved = result.scalar_one_or_none()
    
    if saved:
        processed = saved.processed_groups or []
        if group_index not in processed:
            processed.append(group_index)
            saved.processed_groups = processed
            await db.commit()
    
    return {"success": True}


@router.post("/analyze")
async def analyze_tags(
    request: AnalyzeRequest = None,
    similarity_service: SimilarityService = Depends(get_similarity_service),
    db: AsyncSession = Depends(get_db)
):
    """Analyze tags and find similar groups using AI."""
    batch_size = request.batch_size if request else 200
    result = await similarity_service.find_similar_tags(batch_size=batch_size)
    
    # Save the analysis result
    groups = result.get("groups", [])
    stats = result.get("stats", {})
    
    # Delete old analysis
    await db.execute(delete(SavedAnalysis).where(SavedAnalysis.entity_type == ENTITY_TYPE))
    
    # Save new analysis
    saved = SavedAnalysis(
        entity_type=ENTITY_TYPE,
        analysis_type="similarity",
        groups=groups,
        stats=stats,
        items_count=stats.get("items_count", 0),
        groups_count=len(groups),
        processed_groups=[]
    )
    db.add(saved)
    await db.commit()
    
    return result


@router.post("/merge")
async def merge_tags(
    request: MergeRequest,
    merge_service: MergeService = Depends(get_merge_service)
):
    """Merge multiple tags into one."""
    result = await merge_service.merge_tags(
        target_id=request.target_id,
        target_name=request.target_name,
        source_ids=request.source_ids
    )
    return result


@router.get("/history")
async def get_merge_history(
    merge_service: MergeService = Depends(get_merge_service)
):
    """Get merge history for tags."""
    return await merge_service.get_history("tags")


@router.get("/empty")
async def get_empty_tags(
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Get tags with 0 documents."""
    tags = await client.get_tags_with_counts()
    empty = [t for t in tags if t.get("document_count", 0) == 0]
    return {
        "count": len(empty),
        "items": empty
    }


@router.delete("/empty")
async def delete_empty_tags(
    client: PaperlessClient = Depends(get_paperless_client),
    stats_service: StatisticsService = Depends(get_statistics_service)
):
    """Delete all tags with 0 documents."""
    tags = await client.get_tags_with_counts()
    empty = [t for t in tags if t.get("document_count", 0) == 0]
    
    deleted = 0
    errors = []
    
    for t in empty:
        try:
            await client.delete_tag(t["id"])
            deleted += 1
        except Exception as e:
            errors.append(f"{t['name']}: {str(e)}")
    
    # Record statistics
    if deleted > 0:
        await stats_service.record_operation(
            entity_type="tags",
            operation="deleted",
            items_affected=deleted,
            documents_affected=0,
            items_before=len(tags),
            items_after=len(tags) - deleted
        )
    
    return {
        "deleted": deleted,
        "total": len(empty),
        "errors": errors if errors else None
    }


@router.delete("/{tag_id}")
async def delete_tag(
    tag_id: int,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Delete a single tag by ID."""
    try:
        await client.delete_tag(tag_id)
        return {"success": True, "message": f"Tag {tag_id} deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/analyze-nonsense")
async def analyze_nonsense_tags(
    similarity_service: SimilarityService = Depends(get_similarity_service)
):
    """Analyze tags to find nonsensical/useless tags using AI."""
    result = await similarity_service.find_nonsense_tags()
    return result


@router.post("/analyze-correspondent-matches")
async def analyze_correspondent_matches(
    similarity_service: SimilarityService = Depends(get_similarity_service)
):
    """Analyze tags that should be correspondents using AI."""
    result = await similarity_service.find_tags_that_are_correspondents()
    return result


@router.post("/analyze-doctype-matches")
async def analyze_doctype_matches(
    similarity_service: SimilarityService = Depends(get_similarity_service)
):
    """Analyze tags that should be document types using AI."""
    result = await similarity_service.find_tags_that_are_document_types()
    return result

