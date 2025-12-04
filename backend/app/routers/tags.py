from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
import asyncio
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
    analysis_type: str = "nonsense",
    client: PaperlessClient = Depends(get_paperless_client),
    llm: LLMProviderService = Depends(get_llm_service)
):
    """Estimate tokens needed for specific analysis type.
    
    analysis_type can be: nonsense, correspondent, doctype, similar
    """
    tags = await client.get_tags_with_counts()
    tags_count = len(tags)
    avg_tag_length = sum(len(t.get("name", "")) for t in tags) / max(tags_count, 1)
    
    # Base prompt size varies by analysis type
    prompt_sizes = {
        "nonsense": 800,      # Just tags + nonsense detection prompt
        "correspondent": 1200, # Tags + correspondents + matching prompt
        "doctype": 1000,       # Tags + document types + matching prompt
        "similar": 600         # Just tags + similarity prompt
    }
    base_prompt = prompt_sizes.get(analysis_type, 800)
    
    # Calculate based on analysis type
    if analysis_type == "correspondent":
        correspondents = await client.get_correspondents()
        corr_count = len(correspondents)
        avg_corr_length = sum(len(c.get("name", "")) for c in correspondents) / max(corr_count, 1)
        # Tags + Correspondents
        estimated_chars = base_prompt + tags_count * (avg_tag_length + 10) + corr_count * (avg_corr_length + 5)
        items_info = f"{tags_count} Tags + {corr_count} Korrespondenten"
    elif analysis_type == "doctype":
        doc_types = await client.get_document_types()
        dt_count = len(doc_types)
        avg_dt_length = sum(len(d.get("name", "")) for d in doc_types) / max(dt_count, 1)
        # Tags + Document Types
        estimated_chars = base_prompt + tags_count * (avg_tag_length + 10) + dt_count * (avg_dt_length + 5)
        items_info = f"{tags_count} Tags + {dt_count} Dokumenttypen"
    else:
        # nonsense or similar - just tags
        estimated_chars = base_prompt + tags_count * (avg_tag_length + 10)
        items_info = f"{tags_count} Tags"
    
    # Rough token estimate (1 token ≈ 4 chars)
    estimated_tokens = estimated_chars // 4
    
    # Get token limit and model from LLM provider
    token_limit = llm.get_token_limit()
    model_info = llm.get_model_info()
    model_name = model_info.get("model", "Unbekannt") if model_info else "Nicht konfiguriert"
    safe_limit = int(token_limit * 0.8)
    needs_batching = estimated_tokens > safe_limit
    recommended_batches = max(1, (estimated_tokens + safe_limit - 1) // safe_limit) if needs_batching else 1
    
    return {
        "analysis_type": analysis_type,
        "items_info": items_info,
        "estimated_tokens": estimated_tokens,
        "token_limit": token_limit,
        "model": model_name,
        "recommended_batches": recommended_batches,
        "warning": f"~{estimated_tokens:,} Tokens > {safe_limit:,} Limit. Wird in {recommended_batches} Batches aufgeteilt." if needs_batching else None
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
    """Delete all tags with 0 documents - PARALLEL for speed."""
    tags = await client.get_tags_with_counts()
    empty = [t for t in tags if t.get("document_count", 0) == 0]
    
    if not empty:
        return {"deleted": 0, "total": 0, "errors": None}
    
    # Parallel deletion for speed (batch of 10 at a time to not overwhelm API)
    errors = []
    deleted = 0
    batch_size = 10
    
    async def delete_one(tag):
        try:
            await client.delete_tag(tag["id"])
            return True, None
        except Exception as e:
            return False, f"{tag['name']}: {str(e)}"
    
    for i in range(0, len(empty), batch_size):
        batch = empty[i:i + batch_size]
        results = await asyncio.gather(*[delete_one(t) for t in batch])
        for success, error in results:
            if success:
                deleted += 1
            elif error:
                errors.append(error)
    
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


# ============ NONSENSE TAGS ============
@router.get("/saved-nonsense")
async def get_saved_nonsense_analysis(db: AsyncSession = Depends(get_db)):
    """Check if there's a saved nonsense analysis."""
    result = await db.execute(
        select(SavedAnalysis)
        .where(SavedAnalysis.entity_type == "tags_nonsense")
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
            "groups_count": saved.groups_count
        }
    return {"exists": False}


@router.get("/saved-nonsense/load")
async def load_saved_nonsense_analysis(db: AsyncSession = Depends(get_db)):
    """Load the saved nonsense analysis results."""
    result = await db.execute(
        select(SavedAnalysis)
        .where(SavedAnalysis.entity_type == "tags_nonsense")
        .order_by(SavedAnalysis.created_at.desc())
        .limit(1)
    )
    saved = result.scalar_one_or_none()
    
    if not saved:
        return {"exists": False, "nonsense_tags": []}
    
    return {
        "exists": True,
        "nonsense_tags": saved.groups,
        "stats": saved.stats,
        "created_at": saved.created_at.isoformat() if saved.created_at else None
    }


@router.delete("/saved-nonsense")
async def delete_saved_nonsense_analysis(db: AsyncSession = Depends(get_db)):
    """Delete saved nonsense analysis."""
    await db.execute(delete(SavedAnalysis).where(SavedAnalysis.entity_type == "tags_nonsense"))
    await db.commit()
    return {"success": True}


@router.post("/analyze-nonsense")
async def analyze_nonsense_tags(
    similarity_service: SimilarityService = Depends(get_similarity_service),
    db: AsyncSession = Depends(get_db)
):
    """Analyze tags to find nonsensical/useless tags using AI and SAVE results."""
    result = await similarity_service.find_nonsense_tags()
    
    # Save the analysis result
    nonsense_tags = result.get("nonsense_tags", [])
    stats = result.get("stats", {})
    
    # Delete old analysis
    await db.execute(delete(SavedAnalysis).where(SavedAnalysis.entity_type == "tags_nonsense"))
    
    # Save new analysis
    saved = SavedAnalysis(
        entity_type="tags_nonsense",
        analysis_type="nonsense",
        groups=nonsense_tags,
        stats=stats,
        items_count=stats.get("analyzed_count", len(nonsense_tags)),
        groups_count=len(nonsense_tags)
    )
    db.add(saved)
    await db.commit()
    
    return result


# ============ CORRESPONDENT TAGS ============
@router.get("/saved-correspondent-matches")
async def get_saved_correspondent_analysis(db: AsyncSession = Depends(get_db)):
    """Check if there's a saved correspondent matches analysis."""
    result = await db.execute(
        select(SavedAnalysis)
        .where(SavedAnalysis.entity_type == "tags_correspondents")
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
            "groups_count": saved.groups_count
        }
    return {"exists": False}


@router.get("/saved-correspondent-matches/load")
async def load_saved_correspondent_analysis(db: AsyncSession = Depends(get_db)):
    """Load the saved correspondent matches analysis results."""
    result = await db.execute(
        select(SavedAnalysis)
        .where(SavedAnalysis.entity_type == "tags_correspondents")
        .order_by(SavedAnalysis.created_at.desc())
        .limit(1)
    )
    saved = result.scalar_one_or_none()
    
    if not saved:
        return {"exists": False, "correspondent_tags": []}
    
    return {
        "exists": True,
        "correspondent_tags": saved.groups,
        "stats": saved.stats,
        "created_at": saved.created_at.isoformat() if saved.created_at else None
    }


@router.delete("/saved-correspondent-matches")
async def delete_saved_correspondent_analysis(db: AsyncSession = Depends(get_db)):
    """Delete saved correspondent matches analysis."""
    await db.execute(delete(SavedAnalysis).where(SavedAnalysis.entity_type == "tags_correspondents"))
    await db.commit()
    return {"success": True}


@router.post("/analyze-correspondent-matches")
async def analyze_correspondent_matches(
    similarity_service: SimilarityService = Depends(get_similarity_service),
    db: AsyncSession = Depends(get_db)
):
    """Analyze tags that should be correspondents using AI and SAVE results."""
    result = await similarity_service.find_tags_that_are_correspondents()
    
    # Save the analysis result
    correspondent_tags = result.get("correspondent_tags", [])
    stats = result.get("stats", {})
    
    # Delete old analysis
    await db.execute(delete(SavedAnalysis).where(SavedAnalysis.entity_type == "tags_correspondents"))
    
    # Save new analysis
    saved = SavedAnalysis(
        entity_type="tags_correspondents",
        analysis_type="correspondent_matches",
        groups=correspondent_tags,
        stats=stats,
        items_count=stats.get("tags_count", len(correspondent_tags)),
        groups_count=len(correspondent_tags)
    )
    db.add(saved)
    await db.commit()
    
    return result


# ============ DOCTYPE TAGS ============
@router.get("/saved-doctype-matches")
async def get_saved_doctype_analysis(db: AsyncSession = Depends(get_db)):
    """Check if there's a saved doctype matches analysis."""
    result = await db.execute(
        select(SavedAnalysis)
        .where(SavedAnalysis.entity_type == "tags_doctypes")
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
            "groups_count": saved.groups_count
        }
    return {"exists": False}


@router.get("/saved-doctype-matches/load")
async def load_saved_doctype_analysis(db: AsyncSession = Depends(get_db)):
    """Load the saved doctype matches analysis results."""
    result = await db.execute(
        select(SavedAnalysis)
        .where(SavedAnalysis.entity_type == "tags_doctypes")
        .order_by(SavedAnalysis.created_at.desc())
        .limit(1)
    )
    saved = result.scalar_one_or_none()
    
    if not saved:
        return {"exists": False, "doctype_tags": []}
    
    return {
        "exists": True,
        "doctype_tags": saved.groups,
        "stats": saved.stats,
        "created_at": saved.created_at.isoformat() if saved.created_at else None
    }


@router.delete("/saved-doctype-matches")
async def delete_saved_doctype_analysis(db: AsyncSession = Depends(get_db)):
    """Delete saved doctype matches analysis."""
    await db.execute(delete(SavedAnalysis).where(SavedAnalysis.entity_type == "tags_doctypes"))
    await db.commit()
    return {"success": True}


@router.post("/analyze-doctype-matches")
async def analyze_doctype_matches(
    similarity_service: SimilarityService = Depends(get_similarity_service),
    db: AsyncSession = Depends(get_db)
):
    """Analyze tags that should be document types using AI and SAVE results."""
    result = await similarity_service.find_tags_that_are_document_types()
    
    # Save the analysis result
    doctype_tags = result.get("doctype_tags", [])
    stats = result.get("stats", {})
    
    # Delete old analysis
    await db.execute(delete(SavedAnalysis).where(SavedAnalysis.entity_type == "tags_doctypes"))
    
    # Save new analysis
    saved = SavedAnalysis(
        entity_type="tags_doctypes",
        analysis_type="doctype_matches",
        groups=doctype_tags,
        stats=stats,
        items_count=stats.get("tags_count", len(doctype_tags)),
        groups_count=len(doctype_tags)
    )
    db.add(saved)
    await db.commit()
    
    return result

