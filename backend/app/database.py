from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings
import os

# Ensure data directory exists
os.makedirs("data", exist_ok=True)

# Create async engine
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
)

# Session factory
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def create_tables():
    """Create all database tables."""
    from app.models import settings_model, merge_history, statistics, classifier, ocr, rag, cloud_import, duplicates  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Lightweight migrations for new columns on existing tables
        await _migrate_columns(conn)


async def _migrate_columns(conn):
    """Add missing columns to existing tables (safe to run repeatedly)."""
    import sqlalchemy as sa

    migrations = [
        ("classifier_config", "excluded_tag_ids", "TEXT DEFAULT '[]'"),
        ("classifier_config", "excluded_correspondent_ids", "TEXT DEFAULT '[]'"),
        ("classifier_config", "excluded_document_type_ids", "TEXT DEFAULT '[]'"),
        ("classifier_config", "tags_min", "INTEGER DEFAULT 1"),
        ("classifier_config", "tags_max", "INTEGER DEFAULT 5"),
        ("classifier_config", "tags_keep_existing", "BOOLEAN DEFAULT 1"),
        ("classifier_config", "tags_ignore", "TEXT DEFAULT '[]'"),
        ("classifier_config", "prompt_title", "TEXT DEFAULT ''"),
        ("classifier_config", "prompt_tags", "TEXT DEFAULT ''"),
        ("classifier_config", "prompt_correspondent", "TEXT DEFAULT ''"),
        ("classifier_config", "prompt_document_type", "TEXT DEFAULT ''"),
        ("classifier_config", "prompt_date", "TEXT DEFAULT ''"),
        ("classifier_custom_field_mappings", "ignore_values", "TEXT DEFAULT ''"),
        ("classifier_config", "tags_protected", "TEXT DEFAULT '[]'"),
        ("classifier_config", "dates_ignore", "TEXT DEFAULT '[]'"),
        ("classifier_config", "storage_path_behavior", "TEXT DEFAULT 'always'"),
        ("classifier_config", "storage_path_override_names", "TEXT DEFAULT '[\"Zuweisen\"]'"),
        ("classifier_config", "correspondent_trim_prompt", "BOOLEAN DEFAULT 0"),
        ("classifier_config", "correspondent_strip_legal", "BOOLEAN DEFAULT 0"),
        ("classifier_config", "correspondent_ignore", "TEXT DEFAULT '[]'"),
        ("classifier_config", "auto_classify_enabled", "BOOLEAN DEFAULT 0"),
        ("classifier_config", "auto_classify_interval", "INTEGER DEFAULT 5"),
        ("classifier_config", "auto_classify_mode", "TEXT DEFAULT 'review'"),
        ("classifier_config", "auto_classify_filter_mode", "TEXT DEFAULT 'db'"),
        ("classifier_config", "auto_classify_skip_tag_ids", "TEXT DEFAULT '[]'"),
        ("classifier_config", "auto_classify_only_tag_ids", "TEXT DEFAULT '[]'"),
        ("classifier_history", "tag_ideas", "TEXT DEFAULT '[]'"),
        ("classifier_config", "mistral_api_key", "TEXT DEFAULT ''"),
        ("classifier_config", "mistral_model", "TEXT DEFAULT 'mistral-small-latest'"),
        ("classifier_config", "openrouter_api_key", "TEXT DEFAULT ''"),
        ("classifier_config", "openrouter_model", "TEXT DEFAULT 'mistralai/mistral-small-2603'"),
        # Central LLM Provider table extensions
        ("llm_providers", "classifier_model", "TEXT DEFAULT ''"),
        ("llm_providers", "vision_model", "TEXT DEFAULT ''"),
        # Job assignment in app_settings
        ("app_settings", "classifier_provider", "TEXT DEFAULT 'ollama'"),
        # RAG: LLM Query Rewriting + Contextual Retrieval
        ("rag_config", "query_rewrite_enabled", "BOOLEAN DEFAULT 1"),
        ("rag_config", "contextual_retrieval_enabled", "BOOLEAN DEFAULT 0"),
        ("rag_config", "rag_enabled", "BOOLEAN DEFAULT 0"),
        # Classification Tag
        ("classifier_config", "classification_tag_enabled", "BOOLEAN DEFAULT 0"),
        ("classifier_config", "classification_tag_name", "TEXT DEFAULT 'KI-klassifiziert'"),
        ("classifier_config", "review_tag_enabled", "BOOLEAN DEFAULT 0"),
        ("classifier_config", "review_tag_name", "TEXT DEFAULT 'KI-prüfen'"),
        ("classifier_config", "tag_ideas_tag_enabled", "BOOLEAN DEFAULT 0"),
        ("classifier_config", "tag_ideas_tag_name", "TEXT DEFAULT 'KI-tag-ideen'"),
    ]

    for table, column, col_type in migrations:
        try:
            await conn.execute(sa.text(
                f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
            ))
        except Exception:
            pass  # Column already exists

    # Seed Mistral and OpenRouter providers if missing
    await _seed_new_providers(conn)
    # Migrate classifier config values into the central LLMProvider table
    await _migrate_classifier_to_providers(conn)


async def _seed_new_providers(conn):
    """Add Mistral and OpenRouter to llm_providers if they don't exist yet."""
    import sqlalchemy as sa
    result = await conn.execute(sa.text("SELECT name FROM llm_providers"))
    existing = {row[0] for row in result.fetchall()}

    new_providers = [
        ("mistral", "Mistral AI", "mistral-small-latest"),
        ("openrouter", "OpenRouter", "mistralai/mistral-small-2603"),
    ]
    for name, display, model in new_providers:
        if name not in existing:
            await conn.execute(sa.text(
                "INSERT INTO llm_providers (name, display_name, model, api_key, api_base_url, is_active, is_configured) "
                "VALUES (:name, :display, :model, '', '', 0, 0)"
            ), {"name": name, "display": display, "model": model})


async def _migrate_classifier_to_providers(conn):
    """One-time migration: copy API keys and models from classifier_config into llm_providers."""
    import sqlalchemy as sa

    try:
        result = await conn.execute(sa.text(
            "SELECT active_provider, openai_model, mistral_api_key, mistral_model, "
            "openrouter_api_key, openrouter_model, ollama_host, ollama_model FROM classifier_config LIMIT 1"
        ))
        row = result.fetchone()
    except Exception:
        return  # No classifier_config yet

    if not row:
        return

    active_provider, openai_model, mistral_key, mistral_model, or_key, or_model, ollama_host, ollama_model = row

    # OpenAI: set classifier_model if different from default
    if openai_model:
        await conn.execute(sa.text(
            "UPDATE llm_providers SET classifier_model = :m WHERE name = 'openai' AND (classifier_model IS NULL OR classifier_model = '')"
        ), {"m": openai_model})

    # Mistral: migrate API key + model
    if mistral_key:
        await conn.execute(sa.text(
            "UPDATE llm_providers SET api_key = :k, classifier_model = :m, is_configured = 1 "
            "WHERE name = 'mistral' AND (api_key IS NULL OR api_key = '')"
        ), {"k": mistral_key, "m": mistral_model or "mistral-small-latest"})

    # OpenRouter: migrate API key + model
    if or_key:
        await conn.execute(sa.text(
            "UPDATE llm_providers SET api_key = :k, classifier_model = :m, is_configured = 1 "
            "WHERE name = 'openrouter' AND (api_key IS NULL OR api_key = '')"
        ), {"k": or_key, "m": or_model or "mistralai/mistral-small-2603"})

    # Ollama: set classifier_model + host
    if ollama_model:
        await conn.execute(sa.text(
            "UPDATE llm_providers SET classifier_model = :m WHERE name = 'ollama' AND (classifier_model IS NULL OR classifier_model = '')"
        ), {"m": ollama_model})
    if ollama_host:
        await conn.execute(sa.text(
            "UPDATE llm_providers SET api_base_url = :u WHERE name = 'ollama' AND (api_base_url IS NULL OR api_base_url = '' OR api_base_url = 'http://localhost:11434')"
        ), {"u": ollama_host})

    # Migrate active_provider into app_settings
    if active_provider:
        await conn.execute(sa.text(
            "UPDATE app_settings SET classifier_provider = :p WHERE id = 1 AND (classifier_provider IS NULL OR classifier_provider = 'ollama')"
        ), {"p": active_provider})


async def get_db():
    """Dependency to get database session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()

