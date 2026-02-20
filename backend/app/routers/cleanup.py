from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import Response
from typing import List, Dict, Any
from app.services.paperless_client import PaperlessClient, get_paperless_client
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


class DeleteRequest(BaseModel):
    document_ids: List[int]


class ScanResult(BaseModel):
    documents: List[Dict[str, Any]]
    total_count: int


@router.get("/scan", response_model=ScanResult)
async def scan_junk_documents(
    query: str = Query("", description="Comma-separated search terms"),
    limit: int = Query(50, description="Max results"),
    search_content: bool = Query(False, description="Search in document content, not just title"),
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Scan for junk documents by title or full-text content matching."""
    try:
        # Parse terms from query - frontend sends comma-separated terms
        if query.strip():
            terms = [t.strip() for t in query.split(",") if t.strip()]
        else:
            terms = []

        if not terms:
            return {"documents": [], "total_count": 0}

        # Determine query format based on search_content flag
        query_prefix = "" if search_content else "title:"

        # Fetch documents for each term
        seen_ids = set()
        results = []

        for term in terms:
            documents = await client.get_documents(
                query=f"{query_prefix}{term}",
                page_size=limit
            )
            for doc in documents:
                doc_id = doc.get("id")
                if doc_id not in seen_ids:
                    seen_ids.add(doc_id)
                    results.append({
                        "id": doc_id,
                        "title": doc.get("title"),
                        "created": doc.get("created"),
                        "correspondent": doc.get("correspondent"),
                        "thumbnail_url": f"/api/cleanup/thumbnail/{doc_id}"
                    })

                if len(results) >= limit:
                    break
            if len(results) >= limit:
                break

        return {"documents": results, "total_count": len(results)}

    except Exception as e:
        logger.error(f"Error scanning documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/thumbnail/{document_id}")
async def get_thumbnail(
    document_id: int,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Proxy a document thumbnail from Paperless (handles auth)."""
    try:
        image_bytes = await client.get_document_thumbnail_bytes(document_id)
        return Response(content=image_bytes, media_type="image/webp")
    except Exception as e:
        logger.error(f"Error getting thumbnail for {document_id}: {e}")
        raise HTTPException(status_code=404, detail="Thumbnail not found")


@router.post("/delete")
async def delete_junk_documents(
    request: DeleteRequest,
    client: PaperlessClient = Depends(get_paperless_client)
):
    """Delete the specified junk documents."""
    deleted_count = 0
    errors = []

    for doc_id in request.document_ids:
        try:
            await client.delete_document(doc_id)
            deleted_count += 1
        except Exception as e:
            logger.error(f"Error deleting document {doc_id}: {e}")
            errors.append({"id": doc_id, "error": str(e)})

    return {
        "success": True,
        "deleted_count": deleted_count,
        "errors": errors
    }
