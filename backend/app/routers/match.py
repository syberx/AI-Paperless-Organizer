"""Transaction Match API — for external accounting/EÜR tools.

POST /api/match/transaction — match a bank transaction to Paperless documents
GET  /api/match/health       — ping (requires valid API key)
GET  /api/match/log          — last 30 match attempts (rolling)

All endpoints require API-Key auth via Authorization header:
  Authorization: Bearer po_...
  (or header "Api-Key: po_...", or ?api_key=po_... query param)
"""

import logging
import time
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, delete as sa_delete, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.match_log import MatchLog
from app.services.paperless_client import PaperlessClient, get_paperless_client
from app.services.transaction_matcher import TransactionMatcher

logger = logging.getLogger(__name__)
router = APIRouter()

LOG_RETENTION = 30  # keep only last N entries


async def _require_api_key(request: Request, db: AsyncSession) -> str:
    """Require a valid API key. Returns the key's name for logging."""
    from app.routers.api_keys import validate_api_key
    key = await validate_api_key(request, db)
    if not key:
        raise HTTPException(status_code=401, detail="Missing or invalid API key")
    return key.name


# ─── Pydantic Schemas ────────────────────────────────────────────────────────

class TransactionInput(BaseModel):
    amount: Optional[float] = None
    date: Optional[str] = None  # YYYY-MM-DD
    description: Optional[str] = ""
    customer: Optional[str] = ""
    iban: Optional[str] = ""
    bookingNumber: Optional[str] = ""
    paypalTransactionId: Optional[str] = ""
    paypalInvoiceNumber: Optional[str] = ""
    paypalSubject: Optional[str] = ""
    paymentProvider: Optional[str] = ""


class MatchingOptions(BaseModel):
    dateWindowDays: int = 7
    amountToleranceEur: float = 0.0
    amountTolerancePercent: float = 0.0
    fuzzyThreshold: int = 75
    limit: int = 3


class MatchRequest(BaseModel):
    transaction: TransactionInput
    options: Optional[MatchingOptions] = None


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/health")
async def health(request: Request, db: AsyncSession = Depends(get_db)):
    await _require_api_key(request, db)
    return {"status": "ok", "service": "match"}


@router.post("/transaction")
async def match_transaction(
    request: Request,
    body: MatchRequest,
    db: AsyncSession = Depends(get_db),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Match a bank transaction to Paperless documents. Returns top N scored matches."""
    key_name = await _require_api_key(request, db)

    opts = body.options or MatchingOptions()
    tx = body.transaction.model_dump()

    start = time.time()
    try:
        matcher = TransactionMatcher(client)
        matches = await matcher.match(
            tx,
            date_window_days=opts.dateWindowDays,
            amount_tolerance_eur=opts.amountToleranceEur,
            amount_tolerance_percent=opts.amountTolerancePercent,
            fuzzy_threshold=opts.fuzzyThreshold,
            limit=opts.limit,
        )
    except Exception as e:
        logger.exception("Transaction match failed")
        raise HTTPException(status_code=500, detail=f"Match-Fehler: {e}")

    duration_ms = int((time.time() - start) * 1000)

    # Log (rolling 30)
    try:
        summary_parts = []
        if tx.get("amount") is not None:
            summary_parts.append(f"{tx['amount']:.2f}€")
        if tx.get("date"):
            summary_parts.append(tx["date"])
        if tx.get("customer"):
            summary_parts.append(tx["customer"][:40])
        if tx.get("bookingNumber"):
            summary_parts.append(f"#{tx['bookingNumber']}")
        summary = " · ".join(summary_parts) or "(empty)"

        log_entry = MatchLog(
            api_key_name=key_name,
            transaction_summary=summary[:500],
            request_json={"transaction": tx, "options": opts.model_dump()},
            matches_count=len(matches),
            top_score=matches[0]["score"] if matches else 0,
            top_doc_id=matches[0]["documentId"] if matches else None,
            duration_ms=duration_ms,
        )
        db.add(log_entry)
        await db.commit()

        # Prune to last N
        count_q = await db.execute(select(sa_func.count(MatchLog.id)))
        total = count_q.scalar() or 0
        if total > LOG_RETENTION:
            oldest_q = await db.execute(
                select(MatchLog.id).order_by(MatchLog.id.asc()).limit(total - LOG_RETENTION)
            )
            old_ids = [r[0] for r in oldest_q.all()]
            if old_ids:
                await db.execute(sa_delete(MatchLog).where(MatchLog.id.in_(old_ids)))
                await db.commit()
    except Exception as e:
        logger.warning(f"Match-Log konnte nicht gespeichert werden: {e}")

    return {
        "matches": matches,
        "count": len(matches),
        "durationMs": duration_ms,
    }


@router.get("/log")
async def get_match_log(request: Request, db: AsyncSession = Depends(get_db)):
    """Get the last 30 match attempts (rolling log)."""
    await _require_api_key(request, db)
    result = await db.execute(select(MatchLog).order_by(MatchLog.id.desc()).limit(LOG_RETENTION))
    entries = result.scalars().all()
    return [
        {
            "id": e.id,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "api_key_name": e.api_key_name,
            "summary": e.transaction_summary,
            "matches_count": e.matches_count,
            "top_score": e.top_score,
            "top_doc_id": e.top_doc_id,
            "duration_ms": e.duration_ms,
        }
        for e in entries
    ]
