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
    from app.models import settings_model, merge_history, statistics, classifier, ocr  # noqa: F401
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
        ("classifier_history", "tag_ideas", "TEXT DEFAULT '[]'"),
        ("classifier_config", "mistral_api_key", "TEXT DEFAULT ''"),
        ("classifier_config", "mistral_model", "TEXT DEFAULT 'mistral-small-latest'"),
    ]

    for table, column, col_type in migrations:
        try:
            await conn.execute(sa.text(
                f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
            ))
        except Exception:
            pass  # Column already exists


async def get_db():
    """Dependency to get database session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()

