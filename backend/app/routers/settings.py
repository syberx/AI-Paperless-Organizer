from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import PaperlessSettings, LLMProvider, CustomPrompt, IgnoredTag, AppSettings
import hashlib
from app.prompts.default_prompts import DEFAULT_PROMPTS

router = APIRouter()


# Pydantic models for requests/responses
class PaperlessSettingsSchema(BaseModel):
    url: str
    api_token: str


class LLMProviderSchema(BaseModel):
    name: str
    display_name: str
    api_key: Optional[str] = ""
    api_base_url: Optional[str] = ""
    model: Optional[str] = ""
    is_active: bool = False


class CustomPromptSchema(BaseModel):
    entity_type: str
    prompt_template: str
    is_active: bool = True


# Paperless Settings
@router.get("/paperless")
async def get_paperless_settings(db: AsyncSession = Depends(get_db)):
    """Get Paperless connection settings."""
    result = await db.execute(select(PaperlessSettings).where(PaperlessSettings.id == 1))
    settings = result.scalar_one_or_none()
    
    if not settings:
        return {"url": "", "api_token": "", "is_configured": False}
    
    return {
        "url": settings.url,
        "api_token": "***" if settings.api_token else "",
        "is_configured": settings.is_configured
    }


@router.post("/paperless")
async def save_paperless_settings(
    data: PaperlessSettingsSchema,
    db: AsyncSession = Depends(get_db)
):
    """Save Paperless connection settings."""
    result = await db.execute(select(PaperlessSettings).where(PaperlessSettings.id == 1))
    settings = result.scalar_one_or_none()
    
    if settings:
        settings.url = data.url
        # Only update token if it's not the masked value "***"
        if data.api_token and data.api_token != "***":
            settings.api_token = data.api_token
        # Check if configured (use existing token if masked)
        actual_token = settings.api_token if data.api_token == "***" else data.api_token
        settings.is_configured = bool(data.url and actual_token)
    else:
        # New settings - token must be provided
        if data.api_token == "***":
            raise HTTPException(status_code=400, detail="API Token muss angegeben werden")
        settings = PaperlessSettings(
            id=1,
            url=data.url,
            api_token=data.api_token,
            is_configured=bool(data.url and data.api_token)
        )
        db.add(settings)
    
    await db.commit()
    return {"success": True, "is_configured": settings.is_configured}


# LLM Providers
@router.get("/llm-providers")
async def get_llm_providers(db: AsyncSession = Depends(get_db)):
    """Get all LLM provider configurations."""
    result = await db.execute(select(LLMProvider).order_by(LLMProvider.name))
    providers = result.scalars().all()
    
    # If no providers exist, create defaults
    if not providers:
        default_providers = [
            {"name": "openai", "display_name": "OpenAI", "model": "gpt-4o"},
            {"name": "anthropic", "display_name": "Anthropic Claude", "model": "claude-3-5-sonnet-20241022"},
            {"name": "azure", "display_name": "Azure OpenAI", "model": "gpt-4"},
            {"name": "ollama", "display_name": "Ollama (Lokal)", "api_base_url": "http://localhost:11434", "model": "llama3.1"},
        ]
        for p in default_providers:
            provider = LLMProvider(**p)
            db.add(provider)
        await db.commit()
        
        result = await db.execute(select(LLMProvider).order_by(LLMProvider.name))
        providers = result.scalars().all()
    
    return [
        {
            "id": p.id,
            "name": p.name,
            "display_name": p.display_name,
            "api_key": "***" if p.api_key else "",
            "api_base_url": p.api_base_url,
            "model": p.model,
            "is_active": p.is_active,
            "is_configured": p.is_configured
        }
        for p in providers
    ]


@router.put("/llm-providers/{provider_id}")
async def update_llm_provider(
    provider_id: int,
    data: LLMProviderSchema,
    db: AsyncSession = Depends(get_db)
):
    """Update an LLM provider configuration."""
    result = await db.execute(select(LLMProvider).where(LLMProvider.id == provider_id))
    provider = result.scalar_one_or_none()
    
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    # If setting this provider as active, deactivate others
    if data.is_active:
        await db.execute(
            LLMProvider.__table__.update().values(is_active=False)
        )
    
    # Keep old key if *** or empty string is sent (don't accidentally clear the key)
    if data.api_key and data.api_key != "***":
        provider.api_key = data.api_key
    # else: keep existing provider.api_key
    provider.api_base_url = data.api_base_url
    provider.model = data.model
    provider.is_active = data.is_active
    # Provider is configured if it has a key (new or existing) or is Ollama
    provider.is_configured = bool(
        provider.api_key or provider.name == "ollama"
    )
    
    await db.commit()
    return {"success": True}


# Custom Prompts - Display names for UI
PROMPT_DISPLAY_NAMES = {
    "correspondents": "Korrespondenten gruppieren",
    "tags": "Tags gruppieren",
    "document_types": "Dokumententypen gruppieren",
    "tags_nonsense": "Sinnlose Tags erkennen",
    "tags_are_correspondents": "Tags als Korrespondenten erkennen",
    "tags_are_document_types": "Tags als Dokumententypen erkennen",
}

@router.get("/prompts")
async def get_prompts(db: AsyncSession = Depends(get_db)):
    """Get all custom prompts."""
    result = await db.execute(select(CustomPrompt).order_by(CustomPrompt.entity_type))
    prompts = result.scalars().all()
    
    # Get existing entity types
    existing_types = {p.entity_type for p in prompts}
    
    # Add missing prompts from DEFAULT_PROMPTS
    for entity_type, template in DEFAULT_PROMPTS.items():
        if entity_type not in existing_types:
            prompt = CustomPrompt(
                entity_type=entity_type,
                prompt_template=template,
                is_active=True
            )
            db.add(prompt)
    
    # Commit if we added any
    if len(existing_types) < len(DEFAULT_PROMPTS):
        await db.commit()
        result = await db.execute(select(CustomPrompt).order_by(CustomPrompt.entity_type))
        prompts = result.scalars().all()
    
    return [
        {
            "id": p.id,
            "entity_type": p.entity_type,
            "display_name": PROMPT_DISPLAY_NAMES.get(p.entity_type, p.entity_type),
            "prompt_template": p.prompt_template,
            "is_active": p.is_active
        }
        for p in prompts
    ]


@router.put("/prompts/{prompt_id}")
async def update_prompt(
    prompt_id: int,
    data: CustomPromptSchema,
    db: AsyncSession = Depends(get_db)
):
    """Update a custom prompt."""
    result = await db.execute(select(CustomPrompt).where(CustomPrompt.id == prompt_id))
    prompt = result.scalar_one_or_none()
    
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    
    prompt.prompt_template = data.prompt_template
    prompt.is_active = data.is_active
    
    await db.commit()
    return {"success": True}


@router.post("/prompts/reset/{entity_type}")
async def reset_prompt(
    entity_type: str,
    db: AsyncSession = Depends(get_db)
):
    """Reset a prompt to its default."""
    if entity_type not in DEFAULT_PROMPTS:
        raise HTTPException(status_code=400, detail="Invalid entity type")
    
    result = await db.execute(
        select(CustomPrompt).where(CustomPrompt.entity_type == entity_type)
    )
    prompt = result.scalar_one_or_none()
    
    if prompt:
        prompt.prompt_template = DEFAULT_PROMPTS[entity_type]
        await db.commit()
    
    return {"success": True, "prompt_template": DEFAULT_PROMPTS[entity_type]}


# Ignored Tags
class IgnoredTagSchema(BaseModel):
    pattern: str
    reason: Optional[str] = ""
    is_regex: bool = False


# Default ignored patterns
DEFAULT_IGNORED_TAGS = [
    {"pattern": "INBOX", "reason": "System-Tag für Paperless Eingang"},
    {"pattern": "ai-done", "reason": "Paperless-AI Verarbeitungsmarker"},
    {"pattern": "paperless-ai", "reason": "Paperless-AI System-Tag"},
    {"pattern": "TODO", "reason": "Aufgaben-Marker"},
    {"pattern": "*@*", "reason": "E-Mail-Adressen (Muster)"},
]


@router.get("/ignored-tags")
async def get_ignored_tags(db: AsyncSession = Depends(get_db)):
    """Get all ignored tag patterns."""
    result = await db.execute(select(IgnoredTag).order_by(IgnoredTag.pattern))
    tags = result.scalars().all()
    
    # If empty, create defaults
    if not tags:
        for item in DEFAULT_IGNORED_TAGS:
            tag = IgnoredTag(**item)
            db.add(tag)
        await db.commit()
        
        result = await db.execute(select(IgnoredTag).order_by(IgnoredTag.pattern))
        tags = result.scalars().all()
    
    return [
        {
            "id": t.id,
            "pattern": t.pattern,
            "reason": t.reason,
            "is_regex": t.is_regex
        }
        for t in tags
    ]


@router.post("/ignored-tags")
async def add_ignored_tag(
    data: IgnoredTagSchema,
    db: AsyncSession = Depends(get_db)
):
    """Add a new ignored tag pattern."""
    # Check if already exists
    result = await db.execute(
        select(IgnoredTag).where(IgnoredTag.pattern == data.pattern)
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        raise HTTPException(status_code=400, detail="Pattern already exists")
    
    tag = IgnoredTag(
        pattern=data.pattern,
        reason=data.reason,
        is_regex=data.is_regex
    )
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    
    return {
        "id": tag.id,
        "pattern": tag.pattern,
        "reason": tag.reason,
        "is_regex": tag.is_regex
    }


@router.delete("/ignored-tags/{tag_id}")
async def delete_ignored_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Delete an ignored tag pattern."""
    result = await db.execute(select(IgnoredTag).where(IgnoredTag.id == tag_id))
    tag = result.scalar_one_or_none()
    
    if not tag:
        raise HTTPException(status_code=404, detail="Pattern not found")
    
    await db.delete(tag)
    await db.commit()
    
    return {"success": True}


# App Settings (Password, Debug Toggle, etc.)
class AppSettingsSchema(BaseModel):
    password_enabled: Optional[bool] = None
    password: Optional[str] = None  # Plain password, will be hashed
    show_debug_menu: Optional[bool] = None
    sidebar_compact: Optional[bool] = None


class PasswordVerifySchema(BaseModel):
    password: str


def hash_password(password: str) -> str:
    """Simple password hashing."""
    return hashlib.sha256(password.encode()).hexdigest()


@router.get("/app")
async def get_app_settings(db: AsyncSession = Depends(get_db)):
    """Get application settings."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    settings = result.scalar_one_or_none()
    
    if not settings:
        # Create default settings
        settings = AppSettings(id=1)
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
    
    return {
        "password_enabled": settings.password_enabled,
        "password_set": bool(settings.password_hash),
        "show_debug_menu": settings.show_debug_menu,
        "sidebar_compact": settings.sidebar_compact
    }


@router.put("/app")
async def update_app_settings(
    data: AppSettingsSchema,
    db: AsyncSession = Depends(get_db)
):
    """Update application settings."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    settings = result.scalar_one_or_none()
    
    if not settings:
        settings = AppSettings(id=1)
        db.add(settings)
    
    if data.password_enabled is not None:
        settings.password_enabled = data.password_enabled
    
    if data.password is not None and data.password:
        settings.password_hash = hash_password(data.password)
    
    if data.show_debug_menu is not None:
        settings.show_debug_menu = data.show_debug_menu
    
    if data.sidebar_compact is not None:
        settings.sidebar_compact = data.sidebar_compact
    
    await db.commit()
    
    return {"success": True}


@router.post("/app/verify-password")
async def verify_password(
    data: PasswordVerifySchema,
    db: AsyncSession = Depends(get_db)
):
    """Verify the UI password."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    settings = result.scalar_one_or_none()
    
    if not settings or not settings.password_enabled:
        return {"valid": True, "password_required": False}
    
    if not settings.password_hash:
        return {"valid": True, "password_required": False}
    
    is_valid = settings.password_hash == hash_password(data.password)
    return {"valid": is_valid, "password_required": True}


@router.delete("/app/password")
async def remove_password(db: AsyncSession = Depends(get_db)):
    """Remove the UI password."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    settings = result.scalar_one_or_none()
    
    if settings:
        settings.password_enabled = False
        settings.password_hash = ""
        await db.commit()
    
    return {"success": True}

