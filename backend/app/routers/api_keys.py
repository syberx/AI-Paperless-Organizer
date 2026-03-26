import hashlib
import logging
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.rag import ApiKey

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateKeyRequest(BaseModel):
    name: str


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    is_active: bool
    created_at: Optional[str] = None
    last_used_at: Optional[str] = None


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


@router.post("/generate")
async def generate_api_key(request: CreateKeyRequest, db: AsyncSession = Depends(get_db)):
    if not request.name.strip():
        raise HTTPException(status_code=400, detail="Name darf nicht leer sein")

    raw_key = f"po_{secrets.token_hex(24)}"
    key_hash = _hash_key(raw_key)
    key_prefix = raw_key[:10]

    api_key = ApiKey(
        name=request.name.strip(),
        key_hash=key_hash,
        key_prefix=key_prefix,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    return {
        "id": api_key.id,
        "name": api_key.name,
        "key": raw_key,
        "key_prefix": key_prefix,
        "message": "Speichere diesen Key sicher ab - er wird nicht erneut angezeigt!",
    }


@router.get("/list")
async def list_api_keys(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))
    keys = result.scalars().all()
    return [
        {
            "id": k.id,
            "name": k.name,
            "key_prefix": k.key_prefix,
            "is_active": k.is_active,
            "created_at": k.created_at.isoformat() if k.created_at else None,
            "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
        }
        for k in keys
    ]


@router.delete("/{key_id}")
async def delete_api_key(key_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ApiKey).where(ApiKey.id == key_id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API-Key nicht gefunden")
    await db.execute(sa_delete(ApiKey).where(ApiKey.id == key_id))
    await db.commit()
    return {"deleted": True}


@router.put("/{key_id}/toggle")
async def toggle_api_key(key_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ApiKey).where(ApiKey.id == key_id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API-Key nicht gefunden")
    key.is_active = not key.is_active
    await db.commit()
    return {"id": key.id, "is_active": key.is_active}


async def validate_api_key(request: Request, db: AsyncSession) -> Optional[ApiKey]:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    elif auth_header.startswith("Api-Key "):
        token = auth_header[8:]
    else:
        api_key_param = request.query_params.get("api_key", "")
        token = api_key_param

    if not token:
        return None

    key_hash = _hash_key(token)
    result = await db.execute(
        select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.is_active == True)
    )
    api_key = result.scalar_one_or_none()
    if api_key:
        api_key.last_used_at = datetime.utcnow()
        await db.commit()
    return api_key
