"""API Router for the KI-Klassifizierer feature."""

import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from dataclasses import asdict

from app.database import get_db
from app.services.paperless_client import PaperlessClient, get_paperless_client
from app.services.classifier.service import DocumentClassifierService
from app.models.classifier import (
    ClassifierConfig, StoragePathProfile, CustomFieldMapping, ClassificationHistory,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# --- Pydantic Models ---

class ClassifierConfigUpdate(BaseModel):
    # Provider fields removed — now managed centrally in Settings → LLM
    enable_title: Optional[bool] = None
    enable_tags: Optional[bool] = None
    enable_correspondent: Optional[bool] = None
    enable_document_type: Optional[bool] = None
    enable_storage_path: Optional[bool] = None
    enable_created_date: Optional[bool] = None
    enable_custom_fields: Optional[bool] = None
    tag_behavior: Optional[str] = None
    correspondent_behavior: Optional[str] = None
    review_mode: Optional[str] = None
    batch_size: Optional[int] = None
    prompt_title: Optional[str] = None
    prompt_tags: Optional[str] = None
    prompt_correspondent: Optional[str] = None
    prompt_document_type: Optional[str] = None
    prompt_date: Optional[str] = None
    system_prompt: Optional[str] = None
    tags_min: Optional[int] = None
    tags_max: Optional[int] = None
    tags_keep_existing: Optional[bool] = None
    tags_ignore: Optional[List[str]] = None
    tags_protected: Optional[List[str]] = None
    dates_ignore: Optional[List[str]] = None
    storage_path_behavior: Optional[str] = None
    storage_path_override_names: Optional[List[str]] = None
    excluded_tag_ids: Optional[List[int]] = None
    excluded_correspondent_ids: Optional[List[int]] = None
    excluded_document_type_ids: Optional[List[int]] = None
    correspondent_trim_prompt: Optional[bool] = None
    correspondent_strip_legal: Optional[bool] = None
    correspondent_ignore: Optional[List[str]] = None
    auto_classify_enabled: Optional[bool] = None
    auto_classify_interval: Optional[int] = None
    auto_classify_mode: Optional[str] = None
    auto_classify_skip_tag_ids: Optional[List[int]] = None
    auto_classify_only_tag_ids: Optional[List[int]] = None
    classification_tag_enabled: Optional[bool] = None
    classification_tag_name: Optional[str] = None
    review_tag_enabled: Optional[bool] = None
    review_tag_name: Optional[str] = None
    tag_ideas_tag_enabled: Optional[bool] = None
    tag_ideas_tag_name: Optional[str] = None


class StoragePathProfileUpdate(BaseModel):
    paperless_path_id: int
    paperless_path_name: str = ""
    paperless_path_path: str = ""
    enabled: bool = True
    person_name: str = ""
    path_type: str = "private"
    context_prompt: str = ""


class CustomFieldMappingUpdate(BaseModel):
    paperless_field_id: int
    paperless_field_name: str = ""
    paperless_field_type: str = "string"
    enabled: bool = False
    extraction_prompt: str = ""
    example_values: str = ""
    validation_regex: str = ""
    ignore_values: str = ""


class ApplyRequest(BaseModel):
    document_id: int
    classification: Dict[str, Any]


# --- Helper ---

def _get_service(
    db: AsyncSession = Depends(get_db),
    paperless: PaperlessClient = Depends(get_paperless_client),
) -> DocumentClassifierService:
    return DocumentClassifierService(db, paperless)


# --- Config ---

@router.get("/config")
async def get_config(
    service: DocumentClassifierService = Depends(_get_service),
    db: AsyncSession = Depends(get_db),
):
    """Get classifier configuration."""
    config = await service.get_config()

    # Read classifier provider from central AppSettings
    from app.models import AppSettings as _AppSettings
    app_s = await db.execute(select(_AppSettings).where(_AppSettings.id == 1))
    app_settings = app_s.scalar_one_or_none()
    active_provider = (getattr(app_settings, "classifier_provider", None) or "ollama") if app_settings else "ollama"

    # Read model info from central LLMProvider table
    from app.models import LLMProvider as _LLP
    llp_result = await db.execute(select(_LLP).where(_LLP.name == active_provider))
    llp = llp_result.scalar_one_or_none()
    active_model = (llp.classifier_model or llp.model) if llp else ""

    return {
        "active_provider": active_provider,
        "active_model": active_model,
        "enable_title": config.enable_title,
        "enable_tags": config.enable_tags,
        "enable_correspondent": config.enable_correspondent,
        "enable_document_type": config.enable_document_type,
        "enable_storage_path": config.enable_storage_path,
        "enable_created_date": config.enable_created_date,
        "enable_custom_fields": config.enable_custom_fields,
        "tag_behavior": config.tag_behavior,
        "tags_min": config.tags_min or 1,
        "tags_max": config.tags_max or 5,
        "tags_keep_existing": config.tags_keep_existing if config.tags_keep_existing is not None else True,
        "tags_ignore": config.tags_ignore or [],
        "tags_protected": config.tags_protected or [],
        "dates_ignore": config.dates_ignore or [],
        "storage_path_behavior": config.storage_path_behavior or "always",
        "storage_path_override_names": config.storage_path_override_names or ["Zuweisen"],
        "correspondent_behavior": config.correspondent_behavior,
        "review_mode": config.review_mode,
        "batch_size": config.batch_size,
        "prompt_title": config.prompt_title or "",
        "prompt_tags": config.prompt_tags or "",
        "prompt_correspondent": config.prompt_correspondent or "",
        "prompt_document_type": config.prompt_document_type or "",
        "prompt_date": config.prompt_date or "",
        "system_prompt": config.system_prompt,
        "excluded_tag_ids": config.excluded_tag_ids or [],
        "excluded_correspondent_ids": config.excluded_correspondent_ids or [],
        "excluded_document_type_ids": config.excluded_document_type_ids or [],
        "correspondent_trim_prompt": bool(getattr(config, "correspondent_trim_prompt", False)),
        "correspondent_strip_legal": bool(getattr(config, "correspondent_strip_legal", False)),
        "correspondent_ignore": getattr(config, "correspondent_ignore", None) or [],
        "auto_classify_enabled": bool(getattr(config, "auto_classify_enabled", False)),
        "auto_classify_interval": getattr(config, "auto_classify_interval", 5) or 5,
        "auto_classify_mode": getattr(config, "auto_classify_mode", "review") or "review",
    }


@router.put("/config")
async def update_config(
    data: ClassifierConfigUpdate,
    service: DocumentClassifierService = Depends(_get_service),
):
    """Update classifier configuration."""
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    config = await service.save_config(update)
    return {"status": "ok", "active_provider": config.active_provider}


# --- Prompt Defaults ---

@router.get("/prompt-defaults")
async def get_prompt_defaults():
    """Return the default per-field prompt rules for display in the UI."""
    from app.services.classifier.prompts import FIELD_DEFAULTS
    return FIELD_DEFAULTS


# --- Statistics ---

@router.get("/stats")
async def get_classifier_stats(
    db: AsyncSession = Depends(get_db),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Get classification statistics: how many done, open, costs, etc."""
    from sqlalchemy import func as sa_func, case as sa_case

    # Total documents in Paperless
    try:
        total_docs = await client.get_document_count()
    except Exception:
        total_docs = 0

    # History stats
    history_q = await db.execute(
        select(
            sa_func.count(ClassificationHistory.id).label("total"),
            sa_func.sum(
                sa_case(
                    (ClassificationHistory.status == "applied", 1), else_=0
                )
            ).label("applied"),
            sa_func.sum(
                sa_case(
                    (ClassificationHistory.status == "error", 1), else_=0
                )
            ).label("errors"),
            sa_func.sum(ClassificationHistory.tokens_input).label("total_tokens_in"),
            sa_func.sum(ClassificationHistory.tokens_output).label("total_tokens_out"),
            sa_func.sum(ClassificationHistory.cost_usd).label("total_cost"),
            sa_func.avg(ClassificationHistory.duration_seconds).label("avg_duration"),
        )
    )
    row = history_q.first()

    # Unique classified document IDs
    unique_q = await db.execute(
        select(sa_func.count(sa_func.distinct(ClassificationHistory.document_id)))
    )
    unique_classified = unique_q.scalar() or 0

    # Applied unique documents
    applied_unique_q = await db.execute(
        select(sa_func.count(sa_func.distinct(ClassificationHistory.document_id))).where(
            ClassificationHistory.status == "applied"
        )
    )
    applied_unique = applied_unique_q.scalar() or 0

    # Per-provider breakdown
    provider_q = await db.execute(
        select(
            ClassificationHistory.provider,
            ClassificationHistory.model,
            sa_func.count(ClassificationHistory.id).label("count"),
            sa_func.sum(ClassificationHistory.cost_usd).label("cost"),
            sa_func.avg(ClassificationHistory.duration_seconds).label("avg_duration"),
        ).group_by(ClassificationHistory.provider, ClassificationHistory.model)
    )
    providers = [
        {
            "provider": r.provider,
            "model": r.model,
            "count": r.count,
            "cost": round(float(r.cost or 0), 6),
            "avg_duration": round(float(r.avg_duration or 0), 1),
        }
        for r in provider_q.all()
    ]

    # Recent 10
    recent_q = await db.execute(
        select(ClassificationHistory)
        .order_by(ClassificationHistory.created_at.desc())
        .limit(10)
    )
    recent = [
        {
            "document_id": h.document_id,
            "document_title": h.document_title,
            "provider": h.provider,
            "model": h.model,
            "status": h.status,
            "cost_usd": h.cost_usd,
            "duration_seconds": h.duration_seconds,
            "created_at": str(h.created_at) if h.created_at else None,
        }
        for h in recent_q.scalars().all()
    ]

    return {
        "total_documents_paperless": total_docs,
        "unique_classified": unique_classified,
        "unique_applied": applied_unique,
        "remaining": max(0, total_docs - applied_unique),
        "total_runs": row.total or 0,
        "total_applied": int(row.applied or 0),
        "total_errors": int(row.errors or 0),
        "total_tokens_in": int(row.total_tokens_in or 0),
        "total_tokens_out": int(row.total_tokens_out or 0),
        "total_cost_usd": round(float(row.total_cost or 0), 6),
        "avg_duration_seconds": round(float(row.avg_duration or 0), 1),
        "by_provider": providers,
        "recent": recent,
    }


# --- Next Unclassified Document ---

@router.get("/next-unclassified")
async def get_next_unclassified(
    after_id: int = 0,
    db: AsyncSession = Depends(get_db),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Find the next document ID that has not yet been applied/classified.

    Fetches documents from Paperless in small batches ordered by ID (ascending),
    starting after `after_id`, and returns the first one not found in history.
    """
    from sqlalchemy import select as sa_select
    from app.models.classifier import ClassificationHistory

    # Load all applied document IDs from history
    applied_q = await db.execute(
        sa_select(ClassificationHistory.document_id).where(
            ClassificationHistory.status == "applied"
        )
    )
    applied_ids: set = {row[0] for row in applied_q.all()}

    # Fetch documents from Paperless in pages until we find one not yet applied
    BATCH = 50
    page = 1
    while True:
        params = {
            "page_size": BATCH,
            "page": page,
            "ordering": "id",
        }
        if after_id:
            params["id__gt"] = after_id

        result = await client._request("GET", "/documents/", params=params)
        if not result:
            break

        docs = result.get("results", [])
        for doc in docs:
            doc_id = doc.get("id")
            if doc_id and doc_id not in applied_ids:
                return {
                    "found": True,
                    "document_id": doc_id,
                    "title": doc.get("title", ""),
                }

        if not result.get("next"):
            break
        page += 1

    return {"found": False, "document_id": None, "title": ""}


# --- Cache Refresh ---

@router.post("/refresh-cache")
async def refresh_paperless_cache(
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Force refresh all Paperless caches (tags, correspondents, types, paths)."""
    from app.services.cache import get_cache
    cache = get_cache()
    await cache.clear("paperless:")
    tags = await client.get_tags(use_cache=False)
    correspondents = await client.get_correspondents(use_cache=False)
    doc_types = await client.get_document_types(use_cache=False)
    paths = await client.get_storage_paths(use_cache=False)
    return {
        "refreshed": True,
        "tags": len(tags),
        "correspondents": len(correspondents),
        "document_types": len(doc_types),
        "storage_paths": len(paths),
    }


# --- Paperless Items (for filtering UI) ---

@router.get("/tags")
async def get_tags_from_paperless(
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Fetch all tags from Paperless-ngx."""
    tags = await client.get_tags(use_cache=False)
    return tags


@router.get("/correspondents")
async def get_correspondents_from_paperless(
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Fetch all correspondents from Paperless-ngx."""
    correspondents = await client.get_correspondents(use_cache=False)
    return correspondents


@router.get("/document-types")
async def get_document_types_from_paperless(
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Fetch all document types from Paperless-ngx."""
    types = await client.get_document_types(use_cache=False)
    return types


# --- Ollama ---

THINKING_MODEL_PREFIXES = ("qwen3", "deepseek-r1", "qwq")

OLLAMA_RECOMMENDED_MODELS = {
    "qwen2.5:3b": {
        "text": "★ TOP-EMPFEHLUNG -- Schnell (~5-10s), praezises JSON, ideal fuer Klassifizierung",
        "category": "standard",
        "speed": "schnell",
        "quality": "gut",
    },
    "qwen2.5:7b": {
        "text": "★ BESTE QUALITAET -- Etwas langsamer, dafuer hoehere Trefferquote",
        "category": "standard",
        "speed": "mittel",
        "quality": "sehr gut",
    },
    "gemma2:2b": {
        "text": "Ultraschnell, kompakt -- Google-Modell, gut fuer einfache Dokumente",
        "category": "standard",
        "speed": "sehr schnell",
        "quality": "befriedigend",
    },
    "llama3.2:3b": {
        "text": "Schnell, kompakt -- gute Alternative zu qwen2.5:3b",
        "category": "standard",
        "speed": "schnell",
        "quality": "gut",
    },
    "phi3:mini": {
        "text": "Microsoft 3.8B -- stark bei strukturierten Aufgaben",
        "category": "standard",
        "speed": "schnell",
        "quality": "gut",
    },
    "llama3.1:8b": {
        "text": "Meta 8B -- solide, gute deutsche Sprachkenntnisse",
        "category": "standard",
        "speed": "mittel",
        "quality": "gut",
    },
    "gemma2:9b": {
        "text": "Google 9B -- praezise bei strukturiertem Output",
        "category": "standard",
        "speed": "mittel",
        "quality": "sehr gut",
    },
    "mistral:7b": {
        "text": "Mistral 7B -- gute europaeische Sprachunterstuetzung",
        "category": "standard",
        "speed": "mittel",
        "quality": "gut",
    },
    "qwen2.5:14b": {
        "text": "Premium-Qualitaet, braucht >10GB VRAM",
        "category": "standard",
        "speed": "langsam",
        "quality": "exzellent",
    },
    "qwen3:4b": {
        "text": "⚠ THINKING-Modell -- denkt nach (langsamer), aber JSON-Modus erzwungen",
        "category": "thinking",
        "speed": "langsam",
        "quality": "gut",
    },
    "qwen3:8b": {
        "text": "⚠ THINKING-Modell -- denkt nach (langsamer), aber JSON-Modus erzwungen",
        "category": "thinking",
        "speed": "langsam",
        "quality": "sehr gut",
    },
    "qwen3.5:9b": {
        "text": "⚠ THINKING-Modell -- denkt nach (deutlich langsamer, braucht mehr VRAM)",
        "category": "thinking",
        "speed": "sehr langsam",
        "quality": "sehr gut",
    },
    "deepseek-r1:8b": {
        "text": "⚠ THINKING-Modell -- Reasoning-fokussiert, langsam fuer Klassifizierung",
        "category": "thinking",
        "speed": "sehr langsam",
        "quality": "gut",
    },
}


@router.get("/ollama/models")
async def get_ollama_models(
    db: AsyncSession = Depends(get_db),
):
    """List installed Ollama models with recommendations and thinking-model warnings."""
    from app.models import LLMProvider as _LLP
    llp_res = await db.execute(select(_LLP).where(_LLP.name == "ollama"))
    ollama_prov = llp_res.scalar_one_or_none()
    ollama_host = ((ollama_prov.api_base_url if ollama_prov else None) or "http://localhost:11434").rstrip("/")

    installed = []
    connected = False

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{ollama_host}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            connected = True

            for model in data.get("models", []):
                name = model.get("name", "")
                size_bytes = model.get("size", 0)
                size_gb = round(size_bytes / (1024 ** 3), 1) if size_bytes else 0
                param_size = model.get("details", {}).get("parameter_size", "")
                family = model.get("details", {}).get("family", "")

                is_thinking = any(name.startswith(p) for p in THINKING_MODEL_PREFIXES)

                rec_info = None
                for rec_name, rec_data in OLLAMA_RECOMMENDED_MODELS.items():
                    if name.startswith(rec_name.split(":")[0]) and (
                        ":" not in rec_name or name == rec_name or name.startswith(rec_name)
                    ):
                        rec_info = rec_data
                        break

                installed.append({
                    "name": name,
                    "size_gb": size_gb,
                    "parameter_size": param_size,
                    "family": family,
                    "is_thinking": is_thinking,
                    "recommendation": rec_info.get("text") if rec_info else None,
                    "category": rec_info.get("category", "thinking" if is_thinking else "standard") if rec_info else ("thinking" if is_thinking else "standard"),
                    "speed": rec_info.get("speed") if rec_info else None,
                    "quality": rec_info.get("quality") if rec_info else None,
                })

    except Exception as e:
        logger.warning(f"Could not connect to Ollama at {ollama_host}: {e}")

    suggestions = []
    installed_names = {m["name"] for m in installed}
    for rec_name, rec_data in OLLAMA_RECOMMENDED_MODELS.items():
        if rec_data.get("category") == "thinking":
            continue
        if not any(rec_name.split(":")[0] in n for n in installed_names):
            suggestions.append({
                "name": rec_name,
                "recommendation": rec_data["text"],
                "category": rec_data["category"],
                "speed": rec_data.get("speed"),
                "quality": rec_data.get("quality"),
                "install_command": f"ollama pull {rec_name}",
            })

    return {
        "connected": connected,
        "ollama_host": ollama_host,
        "installed": installed,
        "suggestions": suggestions[:5],
        "top_recommendation": "qwen2.5:3b" if "qwen2.5:3b" not in installed_names else "qwen2.5:7b",
    }


@router.post("/ollama/test")
async def test_ollama_connection(
    model: Optional[str] = None,
    host: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Test Ollama connection and selected model. Reads config from central LLM table."""
    from app.models import LLMProvider as _LLP
    llp_res = await db.execute(select(_LLP).where(_LLP.name == "ollama"))
    ollama_prov = llp_res.scalar_one_or_none()
    ollama_host = (host or (ollama_prov.api_base_url if ollama_prov else None) or "http://localhost:11434").rstrip("/")
    model = model or (ollama_prov.classifier_model if ollama_prov else None) or (ollama_prov.model if ollama_prov else "qwen3:4b")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Test connection
            resp = await client.get(f"{ollama_host}/api/tags")
            resp.raise_for_status()
            data = resp.json()

            model_names = [m.get("name", "") for m in data.get("models", [])]
            model_found = any(model in n or n.startswith(model) for n in model_names)

            if not model_found:
                return {
                    "connected": True,
                    "model_available": False,
                    "model": model,
                    "installed_models": model_names,
                    "message": f"Modell '{model}' nicht installiert. Verfuegbar: {', '.join(model_names[:10])}",
                    "install_hint": f"ollama pull {model}",
                }

            # Quick test generation
            resp = await client.post(
                f"{ollama_host}/api/generate",
                json={"model": model, "prompt": "Antworte mit OK", "stream": False},
                timeout=30.0,
            )
            resp.raise_for_status()

            return {
                "connected": True,
                "model_available": True,
                "model": model,
                "message": f"Ollama verbunden, Modell '{model}' funktioniert.",
            }

    except httpx.ConnectError:
        return {
            "connected": False,
            "model_available": False,
            "model": model,
            "message": f"Keine Verbindung zu Ollama unter {ollama_host}. Laeuft Ollama?",
        }
    except Exception as e:
        return {
            "connected": False,
            "model_available": False,
            "model": model,
            "message": f"Fehler: {str(e)}",
        }


@router.post("/mistral/test")
async def test_mistral_connection(
    db: AsyncSession = Depends(get_db),
):
    """Test Mistral API connection."""
    from app.models import LLMProvider as _LLP
    llp_res = await db.execute(select(_LLP).where(_LLP.name == "mistral"))
    prov = llp_res.scalar_one_or_none()
    api_key = prov.api_key if prov else ""
    model = (prov.classifier_model or prov.model) if prov else "mistral-small-latest"

    if not api_key:
        return {"connected": False, "message": "Kein Mistral API-Key konfiguriert. Einstellungen → LLM."}

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key, base_url="https://api.mistral.ai/v1")
        await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Antworte mit OK"}],
            max_tokens=5,
        )
        return {
            "connected": True,
            "model": model,
            "message": f"Mistral verbunden, Modell '{model}' funktioniert.",
        }
    except Exception as e:
        return {"connected": False, "model": model, "message": f"Fehler: {str(e)}"}


@router.post("/openrouter/test")
async def test_openrouter_connection(
    db: AsyncSession = Depends(get_db),
):
    """Test OpenRouter API connection."""
    from app.models import LLMProvider as _LLP
    llp_res = await db.execute(select(_LLP).where(_LLP.name == "openrouter"))
    prov = llp_res.scalar_one_or_none()
    api_key = prov.api_key if prov else ""
    model = (prov.classifier_model or prov.model) if prov else "mistralai/mistral-small-2603"

    if not api_key:
        return {"connected": False, "message": "Kein OpenRouter API-Key konfiguriert. Einstellungen → LLM."}

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            default_headers={"HTTP-Referer": "https://github.com/syberx/AI-Paperless-Organizer"},
        )
        await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "OK"}],
            max_tokens=5,
        )
        return {
            "connected": True,
            "model": model,
            "message": f"OpenRouter verbunden, Modell '{model}' funktioniert.",
        }
    except Exception as e:
        return {"connected": False, "model": model, "message": f"Fehler: {str(e)}"}


# --- Storage Path Profiles ---

@router.get("/storage-paths")
async def get_storage_paths_from_paperless(
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Fetch storage paths from Paperless-ngx."""
    paths = await client.get_storage_paths(use_cache=False)
    return paths


@router.get("/storage-path-profiles")
async def get_storage_path_profiles(
    service: DocumentClassifierService = Depends(_get_service),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Get all storage paths merged with saved profiles. Paths without a profile default to enabled=True."""
    all_paths = await client.get_storage_paths(use_cache=True)
    saved_profiles = await service.get_storage_profiles()
    saved_by_id = {p.paperless_path_id: p for p in saved_profiles}

    result = []
    for path in all_paths:
        path_id = path.get("id")
        profile = saved_by_id.get(path_id)
        result.append({
            "id": profile.id if profile else None,
            "paperless_path_id": path_id,
            "paperless_path_name": path.get("name", ""),
            "paperless_path_path": path.get("path", ""),
            # Default: enabled=True for all paths without explicit config
            "enabled": profile.enabled if profile else True,
            "person_name": profile.person_name if profile else "",
            "path_type": profile.path_type if profile else "private",
            "context_prompt": profile.context_prompt if profile else "",
        })
    return result


@router.put("/storage-path-profiles")
async def save_storage_path_profiles(
    profiles: List[StoragePathProfileUpdate],
    service: DocumentClassifierService = Depends(_get_service),
):
    """Save/update storage path profiles."""
    saved = []
    for p in profiles:
        profile = await service.save_storage_profile(p.model_dump())
        saved.append(profile.paperless_path_id)
    return {"status": "ok", "saved_count": len(saved)}


# --- Custom Fields ---

FIELD_TYPE_PROMPTS = {
    "rechnungsnummer": "Extrahiere die Rechnungsnummer/Belegnummer. Suche nach 'Rechnungsnr', 'RE-', 'Invoice', 'Beleg-Nr' o.ae.",
    "betrag": "Extrahiere den Gesamtbetrag (brutto inkl. MwSt) als Zahl. Punkt als Dezimaltrenner, kein Waehrungszeichen, kein Tausendertrennzeichen. Beispiel: 149.99 statt 149,99 EUR. Bei mehreren Betraegen den Gesamtbetrag (Summe/Total) nehmen.",
    "gesamtbetrag": "Extrahiere den Gesamtbetrag (brutto inkl. MwSt) als Zahl. Punkt als Dezimaltrenner, kein Waehrungszeichen, kein Tausendertrennzeichen. Beispiel: 149.99 statt 149,99 EUR. Bei mehreren Betraegen den Gesamtbetrag (Summe/Total) nehmen.",
    "iban": "Extrahiere die IBAN/Kontonummer des ABSENDERS/EMPFAENGERS (nicht die eigene!). Format: ohne Leerzeichen. Bei aelteren Dokumenten ggf. Kontonummer+BLZ.",
    "kontonummer": "Extrahiere die IBAN/Kontonummer des ABSENDERS/EMPFAENGERS (nicht die eigene!). Format: ohne Leerzeichen. Bei aelteren Dokumenten ggf. Kontonummer+BLZ.",
    "kundennummer": "Extrahiere die Kundennummer/Vertragsnummer. Suche nach 'Kundennr', 'Kd-Nr', 'Vertragsnr' o.ae.",
    "steuernummer": "Extrahiere die Steuernummer oder USt-IdNr. Format: DE + 9 Ziffern (USt-ID) oder XX/XXX/XXXXX.",
    "faelligkeitsdatum": "Extrahiere das Faelligkeitsdatum/Zahlungsziel. Format: YYYY-MM-DD. Suche nach 'zahlbar bis', 'faellig am'.",
    "lieferscheinnummer": "Extrahiere die Lieferscheinnummer. Suche nach 'Lieferschein-Nr', 'LS-Nr', 'Delivery Note' o.ae.",
    "bestellnummer": "Extrahiere die Bestellnummer. Suche nach 'Bestell-Nr', 'Order', 'Auftragsnr' o.ae.",
}

FIELD_TYPE_VALIDATION = {
    "iban": r"^[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}$",
    "betrag": r"^\d+(\.\d{1,2})?$",
    "gesamtbetrag": r"^\d+(\.\d{1,2})?$",
    "faelligkeitsdatum": r"^\d{4}-\d{2}-\d{2}$",
}

@router.get("/custom-fields")
async def get_custom_fields_from_paperless(
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Fetch custom field definitions from Paperless-ngx."""
    fields = await client.get_custom_fields(use_cache=False)
    return fields


@router.get("/custom-field-mappings")
async def get_custom_field_mappings(
    service: DocumentClassifierService = Depends(_get_service),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Get all Paperless custom fields merged with saved mappings."""
    all_fields = await client.get_custom_fields(use_cache=True)
    saved_mappings = await service.get_custom_field_mappings()
    saved_by_id = {m.paperless_field_id: m for m in saved_mappings}

    result = []
    for field in all_fields:
        fid = field.get("id")
        mapping = saved_by_id.get(fid)
        field_type = field.get("data_type", "string")

        auto_prompt = FIELD_TYPE_PROMPTS.get(field.get("name", "").lower(), "")

        result.append({
            "id": mapping.id if mapping else None,
            "paperless_field_id": fid,
            "paperless_field_name": field.get("name", ""),
            "paperless_field_type": field_type,
            "enabled": mapping.enabled if mapping else False,
            "extraction_prompt": mapping.extraction_prompt if mapping and mapping.extraction_prompt else auto_prompt,
            "example_values": mapping.example_values if mapping else "",
            "validation_regex": mapping.validation_regex if mapping else FIELD_TYPE_VALIDATION.get(field.get("name", "").lower(), ""),
            "ignore_values": mapping.ignore_values if mapping else "",
        })
    return result


@router.put("/custom-field-mappings")
async def save_custom_field_mappings(
    mappings: List[CustomFieldMappingUpdate],
    service: DocumentClassifierService = Depends(_get_service),
):
    """Save/update custom field mappings."""
    saved = []
    for m in mappings:
        mapping = await service.save_custom_field_mapping(m.model_dump())
        saved.append(mapping.paperless_field_id)
    return {"status": "ok", "saved_count": len(saved)}


# --- Document Preview ---

@router.get("/document/{document_id}/thumb")
async def get_document_thumbnail(
    document_id: int,
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Get document thumbnail (WebP image) from Paperless."""
    from fastapi.responses import Response
    try:
        image_bytes = await client.get_document_thumbnail_bytes(document_id)
        return Response(content=image_bytes, media_type="image/webp")
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Thumbnail not available: {str(e)}")


@router.get("/document/{document_id}/preview")
async def get_document_preview(
    document_id: int,
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Get document preview (PDF) from Paperless for inline display."""
    from fastapi.responses import Response
    try:
        pdf_bytes = await client.get_document_preview_image(document_id)
        # Detect content type
        if pdf_bytes[:4] == b'%PDF':
            media_type = "application/pdf"
        elif pdf_bytes[:4] == b'\x89PNG':
            media_type = "image/png"
        elif pdf_bytes[:2] == b'\xff\xd8':
            media_type = "image/jpeg"
        elif pdf_bytes[:4] == b'RIFF':
            media_type = "image/webp"
        else:
            media_type = "application/pdf"
        return Response(
            content=pdf_bytes,
            media_type=media_type,
            headers={
                "Content-Disposition": "inline",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Preview not available: {str(e)}")


# --- Classification ---

@router.post("/analyze")
async def analyze_document(
    document_id: int,
    service: DocumentClassifierService = Depends(_get_service),
):
    """Analyze a single document and return classification proposals."""
    result = await service.classify_document(document_id)
    return asdict(result)


class BenchmarkSlot(BaseModel):
    provider: str = "openai"
    model: str = ""


class BenchmarkRequest(BaseModel):
    document_id: int
    slots: List[BenchmarkSlot]


@router.post("/benchmark")
async def benchmark_document(
    req: BenchmarkRequest,
    service: DocumentClassifierService = Depends(_get_service),
):
    """Run classification with N provider/model combos in parallel."""
    return await service.benchmark_document(
        document_id=req.document_id,
        slots=[(s.provider, s.model or None) for s in req.slots],
    )


@router.post("/apply")
async def apply_classification(
    req: ApplyRequest,
    service: DocumentClassifierService = Depends(_get_service),
):
    """Apply a classification to a document in Paperless."""
    result = await service.apply_classification(req.document_id, req.classification)
    return result


# --- History ---

@router.get("/history")
async def get_history(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """Get classification history including stored result_json for review."""
    result = await db.execute(
        select(ClassificationHistory)
        .order_by(ClassificationHistory.created_at.desc())
        .limit(limit)
    )
    entries = result.scalars().all()
    return [
        {
            "id": e.id,
            "document_id": e.document_id,
            "document_title": e.document_title,
            "provider": e.provider,
            "model": e.model,
            "tokens_input": e.tokens_input,
            "tokens_output": e.tokens_output,
            "cost_usd": e.cost_usd,
            "duration_seconds": e.duration_seconds,
            "tool_calls_count": e.tool_calls_count,
            "status": e.status,
            "error_message": e.error_message,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "result_json": e.result_json,
        }
        for e in entries
    ]


@router.get("/tag-stats")
async def get_tag_stats(db: AsyncSession = Depends(get_db)):
    """Aggregate tag usage statistics from all applied history entries."""
    import json as _json

    q = await db.execute(
        select(ClassificationHistory).where(
            ClassificationHistory.result_json.isnot(None)
        )
    )
    entries = q.scalars().all()

    tag_counts: dict = {}
    tag_new_counts: dict = {}
    tag_applied_counts: dict = {}  # only from applied entries

    for e in entries:
        rj = e.result_json
        if isinstance(rj, str):
            try:
                rj = _json.loads(rj)
            except Exception:
                continue
        if not isinstance(rj, dict):
            continue

        tags = rj.get("tags") or []
        tags_new = rj.get("tags_new") or []

        for tag in tags:
            if not tag:
                continue
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
            if e.status == "applied":
                tag_applied_counts[tag] = tag_applied_counts.get(tag, 0) + 1

        for tag in tags_new:
            if tag:
                tag_new_counts[tag] = tag_new_counts.get(tag, 0) + 1

    sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)
    return {
        "top_tags": [
            {
                "name": name,
                "count": count,
                "applied_count": tag_applied_counts.get(name, 0),
                "new_count": tag_new_counts.get(name, 0),
            }
            for name, count in sorted_tags[:40]
        ],
        "total_unique_tags": len(tag_counts),
        "total_tag_assignments": sum(tag_counts.values()),
        "total_new_tags_created": len(tag_new_counts),
    }


# ── Auto-Classify Background Job ─────────────────────────────────────────────

import asyncio

_auto_classify_state: Dict[str, Any] = {
    "enabled": False,
    "running": False,
    "task": None,
    "processed": 0,
    "errors": 0,
    "reviewed": 0,
    "current_doc": None,
    "last_run": None,
    "filter_mode": "db",  # "db" = new docs only (skip DB history), "tag" = only docs with tag (re-classify possible)
}


async def _auto_classify_loop():
    """Background loop that classifies unprocessed documents."""
    import time
    from app.database import async_session
    from app.services.ollama_lock import acquire as ollama_acquire, release as ollama_release, is_locked as ollama_is_locked, current_holder as ollama_holder

    while _auto_classify_state["enabled"]:
        _auto_classify_state["last_run"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _auto_classify_state["running"] = False

        try:
            async with async_session() as db_sess:
                from app.models.settings_model import PaperlessSettings
                pl_q = await db_sess.execute(
                    select(PaperlessSettings).where(PaperlessSettings.id == 1)
                )
                pl_settings = pl_q.scalars().first()
                if not pl_settings or not pl_settings.is_configured:
                    logger.warning("Auto-classify: Paperless nicht konfiguriert, warte...")
                    _auto_classify_state["running"] = False
                    await asyncio.sleep(60)
                    continue

                client = PaperlessClient(
                    base_url=pl_settings.url,
                    api_token=pl_settings.api_token,
                )
                service = DocumentClassifierService(db_sess, client)
                config = await service.get_config()

                uses_ollama = config.active_provider == "ollama"
                mode = getattr(config, "auto_classify_mode", "review") or "review"
                interval = getattr(config, "auto_classify_interval", 5) or 5

                # Find already processed document IDs (only in "db" mode)
                filter_mode = _auto_classify_state.get("filter_mode", "db")
                if filter_mode == "db":
                    applied_q = await db_sess.execute(
                        select(ClassificationHistory.document_id).where(
                            ClassificationHistory.status.in_(["applied", "review", "pending"])
                        ).distinct()
                    )
                    classified_ids = {r[0] for r in applied_q.all()}
                else:
                    # Tag mode: don't skip based on DB history — allow re-classification
                    classified_ids = set()

                # Fetch documents in batches to find unclassified ones
                found_any = False
                page = 1
                while _auto_classify_state["enabled"]:
                    result = await client._request(
                        "GET", "/documents/",
                        params={"page_size": 50, "page": page, "ordering": "id"},
                    )
                    if not result:
                        break

                    docs = result.get("results", [])
                    if not docs:
                        break

                    for doc in docs:
                        if not _auto_classify_state["enabled"]:
                            break
                        doc_id = doc.get("id")
                        if doc_id in classified_ids:
                            continue

                        doc_tags = doc.get("tags", [])

                        # Skip documents with tags in auto_classify_skip_tag_ids
                        skip_tags = getattr(config, "auto_classify_skip_tag_ids", None) or []
                        if skip_tags and any(t in skip_tags for t in doc_tags):
                            classified_ids.add(doc_id)
                            continue

                        # If only_tag_ids is set (or tag mode), ONLY classify docs with these tags
                        only_tags = [t for t in (getattr(config, "auto_classify_only_tag_ids", None) or []) if t > 0]
                        if filter_mode == "tag" and not only_tags:
                            # Tag mode requires tags to be configured
                            logger.warning("Auto-classify tag mode: no tags configured, skipping")
                            break
                        if only_tags and not any(t in only_tags for t in doc_tags):
                            continue  # don't add to classified_ids in tag mode — tag might be added later

                        # Per-document Ollama lock: acquire before, release after
                        if uses_ollama:
                            if ollama_is_locked():
                                holder = ollama_holder()
                                logger.info(f"Auto-classify doc {doc_id}: Ollama belegt durch {holder}, warte...")
                                _auto_classify_state["current_doc"] = None
                                while ollama_is_locked() and _auto_classify_state["enabled"]:
                                    await asyncio.sleep(5)
                                if not _auto_classify_state["enabled"]:
                                    break
                            got_lock = await ollama_acquire("classifier", timeout=300)
                            if not got_lock:
                                logger.warning(f"Auto-classify doc {doc_id}: Lock-Timeout, ueberspringe")
                                await asyncio.sleep(10)
                                continue

                        found_any = True
                        _auto_classify_state["running"] = True
                        _auto_classify_state["current_doc"] = doc_id

                        try:
                            res = await service.classify_document_auto(doc_id, mode)
                            action = res.get("action", "")
                            if action == "applied":
                                _auto_classify_state["processed"] += 1
                            elif action == "review":
                                _auto_classify_state["reviewed"] += 1
                            elif action == "error":
                                _auto_classify_state["errors"] += 1
                            else:
                                _auto_classify_state["processed"] += 1
                            classified_ids.add(doc_id)
                            logger.info(f"Auto-classify doc {doc_id}: {action}")
                        except Exception as e:
                            _auto_classify_state["errors"] += 1
                            classified_ids.add(doc_id)
                            logger.error(f"Auto-classify doc {doc_id} failed: {e}")
                        finally:
                            if uses_ollama:
                                ollama_release("classifier")
                            _auto_classify_state["running"] = False
                            _auto_classify_state["current_doc"] = None

                        await asyncio.sleep(2)

                    if not result.get("next"):
                        break
                    page += 1

                if not found_any:
                    logger.info(f"Auto-classify: keine neuen Dokumente, warte {interval} min")

        except Exception as e:
            logger.error(f"Auto-classify loop error: {e}")

        _auto_classify_state["running"] = False
        _auto_classify_state["current_doc"] = None

        if _auto_classify_state["enabled"]:
            interval = 5
            try:
                async with async_session() as db_sess:
                    q = await db_sess.execute(select(ClassifierConfig).where(ClassifierConfig.id == 1))
                    cfg = q.scalars().first()
                    if cfg:
                        interval = getattr(cfg, "auto_classify_interval", 5) or 5
            except Exception:
                pass
            await asyncio.sleep(interval * 60)


class AutoClassifyStartRequest(BaseModel):
    filter_mode: str = "db"  # "db" or "tag"


@router.post("/auto-classify/start")
async def start_auto_classify(
    req: Optional[AutoClassifyStartRequest] = None,
    db: AsyncSession = Depends(get_db),
):
    """Start the auto-classification background job."""
    if _auto_classify_state["enabled"]:
        return {"status": "already_running"}

    filter_mode = (req.filter_mode if req else "db") or "db"
    _auto_classify_state["enabled"] = True
    _auto_classify_state["processed"] = 0
    _auto_classify_state["errors"] = 0
    _auto_classify_state["reviewed"] = 0
    _auto_classify_state["filter_mode"] = filter_mode
    _auto_classify_state["task"] = asyncio.create_task(_auto_classify_loop())
    logger.info(f"Auto-classify started (mode: {filter_mode})")

    # Persist to DB so it auto-starts after restart
    try:
        q = await db.execute(select(ClassifierConfig).where(ClassifierConfig.id == 1))
        config = q.scalars().first()
        if config:
            config.auto_classify_enabled = True
            await db.commit()
    except Exception as e:
        logger.warning(f"Could not persist auto-classify enabled: {e}")

    return {"status": "started"}


@router.post("/auto-classify/stop")
async def stop_auto_classify(db: AsyncSession = Depends(get_db)):
    """Stop the auto-classification background job."""
    _auto_classify_state["enabled"] = False
    task = _auto_classify_state.get("task")
    if task and not task.done():
        task.cancel()
    _auto_classify_state["running"] = False
    _auto_classify_state["current_doc"] = None
    logger.info("Auto-classify stopped")

    # Persist to DB
    try:
        q = await db.execute(select(ClassifierConfig).where(ClassifierConfig.id == 1))
        config = q.scalars().first()
        if config:
            config.auto_classify_enabled = False
            await db.commit()
    except Exception as e:
        logger.warning(f"Could not persist auto-classify disabled: {e}")

    return {"status": "stopped"}


@router.get("/auto-classify/status")
async def get_auto_classify_status():
    """Get current status of the auto-classification job."""
    from app.services.ollama_lock import is_locked as ollama_is_locked, current_holder as ollama_holder
    return {
        "enabled": _auto_classify_state["enabled"],
        "running": _auto_classify_state["running"],
        "processed": _auto_classify_state["processed"],
        "errors": _auto_classify_state["errors"],
        "reviewed": _auto_classify_state["reviewed"],
        "current_doc": _auto_classify_state["current_doc"],
        "last_run": _auto_classify_state["last_run"],
        "filter_mode": _auto_classify_state.get("filter_mode", "db"),
        "waiting_for": ollama_holder() if ollama_is_locked() and _auto_classify_state["enabled"] and ollama_holder() != "classifier" else None,
    }


# ── Review Queue ──────────────────────────────────────────────────────────────

@router.get("/review-queue")
async def get_review_queue(db: AsyncSession = Depends(get_db)):
    """Get all classification entries that need manual review."""
    result = await db.execute(
        select(ClassificationHistory)
        .where(ClassificationHistory.status == "review")
        .order_by(ClassificationHistory.created_at.desc())
    )
    entries = result.scalars().all()
    return [
        {
            "id": e.id,
            "document_id": e.document_id,
            "document_title": e.document_title,
            "provider": e.provider,
            "model": e.model,
            "status": e.status,
            "error_message": e.error_message,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "result_json": e.result_json,
        }
        for e in entries
    ]


@router.post("/review-queue/{entry_id}/approve")
async def approve_review_entry(
    entry_id: int,
    req: ApplyRequest,
    service: DocumentClassifierService = Depends(_get_service),
    db: AsyncSession = Depends(get_db),
):
    """Approve a review entry: apply classification and mark as applied."""
    # First mark the entry as applied
    q = await db.execute(
        select(ClassificationHistory).where(ClassificationHistory.id == entry_id)
    )
    entry = q.scalars().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Apply the classification
    result = await service.apply_classification(req.document_id, req.classification)

    # Update entry status
    entry.status = "applied"
    entry.error_message = ""
    await db.commit()

    return result


@router.post("/review-queue/{entry_id}/dismiss")
async def dismiss_review_entry(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Dismiss a review entry without applying."""
    q = await db.execute(
        select(ClassificationHistory).where(ClassificationHistory.id == entry_id)
    )
    entry = q.scalars().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    entry.status = "rejected"
    await db.commit()
    return {"status": "dismissed"}


@router.post("/review-queue/clear")
async def clear_review_queue(db: AsyncSession = Depends(get_db)):
    """Clear all entries from the review queue (mark as rejected)."""
    from sqlalchemy import update
    result = await db.execute(
        update(ClassificationHistory)
        .where(ClassificationHistory.status == "review")
        .values(status="rejected")
    )
    await db.commit()
    count = result.rowcount
    logger.info(f"Cleared review queue: {count} entries marked as rejected")
    return {"status": "cleared", "count": count}


# ── Tag Ideas ─────────────────────────────────────────────────────────────────

@router.get("/tag-ideas")
async def get_tag_ideas(db: AsyncSession = Depends(get_db)):
    """Get all history entries that have pending tag ideas."""
    result = await db.execute(
        select(ClassificationHistory)
        .where(ClassificationHistory.tag_ideas.isnot(None))
        .order_by(ClassificationHistory.created_at.desc())
    )
    entries = result.scalars().all()
    items = []
    for e in entries:
        ideas = e.tag_ideas
        if not ideas or (isinstance(ideas, list) and len(ideas) == 0):
            continue
        if isinstance(ideas, str):
            import json as _json
            try:
                ideas = _json.loads(ideas)
            except Exception:
                continue
        if not ideas:
            continue
        items.append({
            "id": e.id,
            "document_id": e.document_id,
            "document_title": e.document_title,
            "provider": e.provider,
            "model": e.model,
            "status": e.status,
            "tag_ideas": ideas,
            "result_json": e.result_json,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        })
    return items


@router.get("/tag-ideas/stats")
async def get_tag_ideas_stats(db: AsyncSession = Depends(get_db)):
    """Aggregate stats: which new tags are suggested most frequently."""
    result = await db.execute(
        select(ClassificationHistory)
        .where(ClassificationHistory.tag_ideas.isnot(None))
    )
    entries = result.scalars().all()

    from collections import Counter
    import json as _json

    tag_counter: Counter = Counter()
    tag_docs: dict = {}

    for e in entries:
        ideas = e.tag_ideas
        if isinstance(ideas, str):
            try:
                ideas = _json.loads(ideas)
            except Exception:
                continue
        if not ideas or not isinstance(ideas, list):
            continue
        for tag_name in ideas:
            tag_counter[tag_name] += 1
            if tag_name not in tag_docs:
                tag_docs[tag_name] = []
            tag_docs[tag_name].append(e.document_id)

    top_tags = [
        {"name": name, "count": count, "document_ids": tag_docs.get(name, [])}
        for name, count in tag_counter.most_common(50)
    ]
    return {
        "total_ideas": sum(tag_counter.values()),
        "unique_tags": len(tag_counter),
        "documents_with_ideas": len([e for e in entries if e.tag_ideas and (isinstance(e.tag_ideas, list) and len(e.tag_ideas) > 0)]),
        "top_tags": top_tags,
    }


class TagIdeaApproveRequest(BaseModel):
    tag_name: str


@router.post("/tag-ideas/{entry_id}/approve")
async def approve_tag_idea(
    entry_id: int,
    req: TagIdeaApproveRequest,
    db: AsyncSession = Depends(get_db),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Approve a single tag idea: create tag in Paperless and add to document."""
    import json as _json

    q = await db.execute(
        select(ClassificationHistory).where(ClassificationHistory.id == entry_id)
    )
    entry = q.scalars().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Create or get the tag in Paperless
    tag = await client.get_or_create_tag(req.tag_name)
    if not tag:
        raise HTTPException(status_code=500, detail=f"Could not create tag '{req.tag_name}'")

    # Add tag to the document
    doc = await client.get_document(entry.document_id)
    if doc:
        existing_tags = doc.get("tags", [])
        if tag["id"] not in existing_tags:
            existing_tags.append(tag["id"])
            await client.update_document(entry.document_id, {"tags": existing_tags})
            logger.info(f"Tag idea approved: '{req.tag_name}' added to doc {entry.document_id}")

    # Remove this tag from the ideas list
    ideas = entry.tag_ideas
    if isinstance(ideas, str):
        try:
            ideas = _json.loads(ideas)
        except Exception:
            ideas = []
    if isinstance(ideas, list):
        ideas = [t for t in ideas if t != req.tag_name]
    entry.tag_ideas = ideas
    await db.commit()

    # Clear cache so new tag is visible
    from app.services.cache import get_cache
    await get_cache().clear("paperless:")

    return {"status": "approved", "tag_name": req.tag_name, "remaining_ideas": ideas}


@router.post("/tag-ideas/{entry_id}/dismiss")
async def dismiss_tag_idea(
    entry_id: int,
    req: TagIdeaApproveRequest,
    db: AsyncSession = Depends(get_db),
):
    """Dismiss a single tag idea (remove from suggestions without creating)."""
    import json as _json

    q = await db.execute(
        select(ClassificationHistory).where(ClassificationHistory.id == entry_id)
    )
    entry = q.scalars().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    ideas = entry.tag_ideas
    if isinstance(ideas, str):
        try:
            ideas = _json.loads(ideas)
        except Exception:
            ideas = []
    if isinstance(ideas, list):
        ideas = [t for t in ideas if t != req.tag_name]
    entry.tag_ideas = ideas
    await db.commit()

    return {"status": "dismissed", "tag_name": req.tag_name, "remaining_ideas": ideas}


@router.post("/tag-ideas/{entry_id}/approve-all")
async def approve_all_tag_ideas(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Approve ALL tag ideas for a single document."""
    import json as _json

    q = await db.execute(
        select(ClassificationHistory).where(ClassificationHistory.id == entry_id)
    )
    entry = q.scalars().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    ideas = entry.tag_ideas
    if isinstance(ideas, str):
        try:
            ideas = _json.loads(ideas)
        except Exception:
            ideas = []
    if not ideas:
        return {"status": "nothing_to_approve"}

    doc = await client.get_document(entry.document_id)
    existing_tags = doc.get("tags", []) if doc else []

    approved = []
    for tag_name in ideas:
        tag = await client.get_or_create_tag(tag_name)
        if tag and tag["id"] not in existing_tags:
            existing_tags.append(tag["id"])
            approved.append(tag_name)

    if existing_tags and doc:
        await client.update_document(entry.document_id, {"tags": existing_tags})

    entry.tag_ideas = []
    await db.commit()

    from app.services.cache import get_cache
    await get_cache().clear("paperless:")

    logger.info(f"All tag ideas approved for doc {entry.document_id}: {approved}")
    return {"status": "approved_all", "approved": approved}


@router.post("/tag-ideas/bulk-approve")
async def bulk_approve_tag_idea(
    req: TagIdeaApproveRequest,
    db: AsyncSession = Depends(get_db),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Approve a specific tag across ALL documents that suggest it."""
    import json as _json

    tag_name = req.tag_name
    from sqlalchemy import func as sa_func
    q = await db.execute(
        select(ClassificationHistory).where(
            ClassificationHistory.tag_ideas.isnot(None),
            sa_func.length(ClassificationHistory.tag_ideas) > 2,
        )
    )
    entries = q.scalars().all()

    affected = 0
    tag_obj = await client.get_or_create_tag(tag_name)
    if not tag_obj:
        raise HTTPException(status_code=500, detail=f"Tag '{tag_name}' konnte nicht erstellt werden")

    for entry in entries:
        ideas = entry.tag_ideas
        if isinstance(ideas, str):
            try:
                ideas = _json.loads(ideas)
            except Exception:
                continue
        if tag_name not in ideas:
            continue

        # Add tag to document
        try:
            doc = await client.get_document(entry.document_id)
            if doc:
                existing_tags = doc.get("tags", [])
                if tag_obj["id"] not in existing_tags:
                    existing_tags.append(tag_obj["id"])
                    await client.update_document(entry.document_id, {"tags": existing_tags})
        except Exception as e:
            logger.warning(f"Failed to add tag to doc {entry.document_id}: {e}")

        # Remove from ideas
        ideas = [t for t in ideas if t != tag_name]
        entry.tag_ideas = ideas
        affected += 1

    await db.commit()
    from app.services.cache import get_cache
    await get_cache().clear("paperless:")

    logger.info(f"Bulk approved tag '{tag_name}' for {affected} documents")
    return {"status": "bulk_approved", "tag_name": tag_name, "documents_affected": affected}


@router.post("/tag-ideas/bulk-dismiss")
async def bulk_dismiss_tag_idea(
    req: TagIdeaApproveRequest,
    db: AsyncSession = Depends(get_db),
):
    """Dismiss a specific tag across ALL documents that suggest it."""
    import json as _json

    tag_name = req.tag_name
    q = await db.execute(select(ClassificationHistory).where(ClassificationHistory.tag_ideas != "[]"))
    entries = q.scalars().all()

    affected = 0
    for entry in entries:
        ideas = entry.tag_ideas
        if isinstance(ideas, str):
            try:
                ideas = _json.loads(ideas)
            except Exception:
                continue
        if tag_name not in ideas:
            continue

        ideas = [t for t in ideas if t != tag_name]
        entry.tag_ideas = ideas
        affected += 1

    await db.commit()

    logger.info(f"Bulk dismissed tag '{tag_name}' from {affected} documents")
    return {"status": "bulk_dismissed", "tag_name": tag_name, "documents_affected": affected}


@router.post("/tag-ideas/{entry_id}/assign-existing")
async def assign_existing_tag(
    entry_id: int,
    req: TagIdeaApproveRequest,
    db: AsyncSession = Depends(get_db),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Assign an existing Paperless tag to a document from the tag-ideas view."""
    q = await db.execute(
        select(ClassificationHistory).where(ClassificationHistory.id == entry_id)
    )
    entry = q.scalars().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    tag_name = req.tag_name
    tag = await client.get_or_create_tag(tag_name)
    if not tag:
        raise HTTPException(status_code=500, detail=f"Tag '{tag_name}' nicht gefunden")

    doc = await client.get_document(entry.document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")

    existing_tags = doc.get("tags", [])
    if tag["id"] not in existing_tags:
        existing_tags.append(tag["id"])
        await client.update_document(entry.document_id, {"tags": existing_tags})

    from app.services.cache import get_cache
    await get_cache().clear("paperless:")

    logger.info(f"Assigned existing tag '{tag_name}' to doc {entry.document_id}")
    return {"status": "assigned", "tag_name": tag_name, "document_id": entry.document_id}
