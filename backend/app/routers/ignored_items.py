"""Router for managing ignored items in analyses."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from typing import Optional, List
from app.database import get_db
from app.models.settings_model import IgnoredItem

router = APIRouter(tags=["Ignored Items"])


class IgnoredItemCreate(BaseModel):
    item_id: int
    item_name: str
    entity_type: str  # "tag", "correspondent", "document_type"
    analysis_type: str  # "nonsense", "correspondent_match", "doctype_match", "similar"
    reason: Optional[str] = ""


class IgnoredItemResponse(BaseModel):
    id: int
    item_id: int
    item_name: str
    entity_type: str
    analysis_type: str
    reason: str
    created_at: str

    class Config:
        from_attributes = True


@router.get("")
async def get_ignored_items(
    entity_type: Optional[str] = None,
    analysis_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
) -> List[IgnoredItemResponse]:
    """Get all ignored items, optionally filtered by entity_type and analysis_type."""
    query = select(IgnoredItem)
    
    if entity_type:
        query = query.where(IgnoredItem.entity_type == entity_type)
    if analysis_type:
        query = query.where(IgnoredItem.analysis_type == analysis_type)
    
    query = query.order_by(IgnoredItem.created_at.desc())
    result = await db.execute(query)
    items = result.scalars().all()
    
    return [
        IgnoredItemResponse(
            id=item.id,
            item_id=item.item_id,
            item_name=item.item_name,
            entity_type=item.entity_type,
            analysis_type=item.analysis_type,
            reason=item.reason or "",
            created_at=item.created_at.isoformat() if item.created_at else ""
        )
        for item in items
    ]


@router.post("")
async def add_ignored_item(
    data: IgnoredItemCreate,
    db: AsyncSession = Depends(get_db)
) -> IgnoredItemResponse:
    """Add an item to the ignore list."""
    # Check if already exists
    existing = await db.execute(
        select(IgnoredItem).where(
            and_(
                IgnoredItem.item_id == data.item_id,
                IgnoredItem.entity_type == data.entity_type,
                IgnoredItem.analysis_type == data.analysis_type
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Item ist bereits auf der Ignorierliste")
    
    item = IgnoredItem(
        item_id=data.item_id,
        item_name=data.item_name,
        entity_type=data.entity_type,
        analysis_type=data.analysis_type,
        reason=data.reason or ""
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    
    return IgnoredItemResponse(
        id=item.id,
        item_id=item.item_id,
        item_name=item.item_name,
        entity_type=item.entity_type,
        analysis_type=item.analysis_type,
        reason=item.reason or "",
        created_at=item.created_at.isoformat() if item.created_at else ""
    )


@router.delete("/{item_id}")
async def remove_ignored_item(
    item_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Remove an item from the ignore list."""
    result = await db.execute(
        select(IgnoredItem).where(IgnoredItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item nicht gefunden")
    
    await db.delete(item)
    await db.commit()
    
    return {"status": "ok", "message": "Item von Ignorierliste entfernt"}


@router.get("/check/{entity_type}/{analysis_type}/{paperless_item_id}")
async def check_if_ignored(
    entity_type: str,
    analysis_type: str,
    paperless_item_id: int,
    db: AsyncSession = Depends(get_db)
) -> dict:
    """Check if a specific item is ignored."""
    result = await db.execute(
        select(IgnoredItem).where(
            and_(
                IgnoredItem.item_id == paperless_item_id,
                IgnoredItem.entity_type == entity_type,
                IgnoredItem.analysis_type == analysis_type
            )
        )
    )
    item = result.scalar_one_or_none()
    return {"ignored": item is not None, "item": item}


@router.get("/ids/{entity_type}/{analysis_type}")
async def get_ignored_ids(
    entity_type: str,
    analysis_type: str,
    db: AsyncSession = Depends(get_db)
) -> List[int]:
    """Get list of ignored item IDs for filtering."""
    result = await db.execute(
        select(IgnoredItem.item_id).where(
            and_(
                IgnoredItem.entity_type == entity_type,
                IgnoredItem.analysis_type == analysis_type
            )
        )
    )
    return [row[0] for row in result.fetchall()]

