import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_

from app.database import get_db
from app.models.duplicates import DuplicateIgnore
from app.services.duplicate_service import DuplicateService, get_scan_state, _scan_state

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class ScanRequest(BaseModel):
    modes: List[str] = ["exact", "similar", "invoices"]
    similarity_threshold: float = 0.92


class IgnoreRequest(BaseModel):
    doc_ids: List[int]


# ── Scan endpoints ───────────────────────────────────────────────────────────

@router.post("/scan")
async def start_scan(body: ScanRequest, db: AsyncSession = Depends(get_db)):
    """Startet einen Duplikat-Scan im Hintergrund."""
    if _scan_state.get("running"):
        raise HTTPException(status_code=409, detail="Scan läuft bereits")

    service = DuplicateService()

    asyncio.create_task(
        service.scan_all(
            modes=body.modes,
            similarity_threshold=body.similarity_threshold,
        )
    )

    return {"status": "started", "modes": body.modes}


@router.get("/status")
async def scan_status():
    """Polling-Endpoint für den Scan-Fortschritt."""
    state = get_scan_state()
    return {
        "running": state.get("running", False),
        "phase": state.get("phase", ""),
        "progress": state.get("progress", 0),
        "total": state.get("total", 0),
        "error": state.get("error"),
    }


@router.post("/stop")
async def stop_scan():
    """Stoppt den laufenden Scan."""
    state = get_scan_state()
    if not state.get("running"):
        return {"status": "not_running"}
    _scan_state["cancel_requested"] = True
    logger.info("Duplicate scan stop requested")
    return {"status": "stopping"}


@router.get("/results")
async def scan_results():
    """Gibt die Ergebnis-Gruppen des letzten Scans zurück."""
    state = get_scan_state()
    if state.get("running"):
        raise HTTPException(status_code=409, detail="Scan läuft noch")
    return {"groups": state.get("results", [])}


# ── Ignore-Liste ─────────────────────────────────────────────────────────────

@router.post("/ignore")
async def ignore_group(body: IgnoreRequest, db: AsyncSession = Depends(get_db)):
    """Markiert eine Gruppe von Dokumenten als 'kein Duplikat'."""
    if len(body.doc_ids) < 2:
        raise HTTPException(status_code=400, detail="Mindestens 2 Dokument-IDs erforderlich")

    # Alle Paare speichern (sortiert, um Duplikate zu vermeiden)
    added = 0
    for i in range(len(body.doc_ids)):
        for j in range(i + 1, len(body.doc_ids)):
            a, b = sorted([body.doc_ids[i], body.doc_ids[j]])
            # Prüfen ob Paar schon existiert
            existing = await db.execute(
                select(DuplicateIgnore).where(
                    and_(
                        DuplicateIgnore.doc_id_a == a,
                        DuplicateIgnore.doc_id_b == b,
                    )
                )
            )
            if existing.scalar_one_or_none() is None:
                db.add(DuplicateIgnore(doc_id_a=a, doc_id_b=b))
                added += 1

    await db.commit()
    logger.info("Added %d ignore pair(s) for doc_ids=%s", added, body.doc_ids)
    return {"added": added}


@router.get("/ignored")
async def list_ignored(db: AsyncSession = Depends(get_db)):
    """Gibt alle ignorierten Paare zurück."""
    result = await db.execute(select(DuplicateIgnore).order_by(DuplicateIgnore.created_at.desc()))
    rows = result.scalars().all()
    return [
        {
            "id": row.id,
            "doc_id_a": row.doc_id_a,
            "doc_id_b": row.doc_id_b,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.delete("/ignore/{doc_id_a}/{doc_id_b}")
async def remove_ignore(doc_id_a: int, doc_id_b: int, db: AsyncSession = Depends(get_db)):
    """Hebt die Ignorierung eines Paares auf."""
    a, b = sorted([doc_id_a, doc_id_b])
    result = await db.execute(
        delete(DuplicateIgnore).where(
            and_(
                DuplicateIgnore.doc_id_a == a,
                DuplicateIgnore.doc_id_b == b,
            )
        )
    )
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Paar nicht gefunden")

    logger.info("Removed ignore pair (%d, %d)", a, b)
    return {"removed": True}
