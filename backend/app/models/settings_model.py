from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


class PaperlessSettings(Base):
    """Paperless-ngx connection settings."""
    __tablename__ = "paperless_settings"
    
    id = Column(Integer, primary_key=True, default=1)
    url = Column(String(500), nullable=False, default="")
    api_token = Column(String(500), nullable=False, default="")
    is_configured = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class LLMProvider(Base):
    """LLM Provider configuration."""
    __tablename__ = "llm_providers"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)  # openai, anthropic, azure, ollama
    display_name = Column(String(200), nullable=False)
    api_key = Column(String(500), default="")
    api_base_url = Column(String(500), default="")  # For Ollama or Azure
    model = Column(String(200), default="")
    is_active = Column(Boolean, default=False)
    is_configured = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CustomPrompt(Base):
    """Custom prompts for different entity types."""
    __tablename__ = "custom_prompts"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_type = Column(String(50), nullable=False)  # correspondents, tags, document_types
    prompt_template = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class IgnoredTag(Base):
    """Tags that should be ignored during cleanup analysis."""
    __tablename__ = "ignored_tags"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    pattern = Column(String(500), nullable=False)  # Can be exact name or pattern
    reason = Column(String(500), default="")  # Why it's ignored
    is_regex = Column(Boolean, default=False)  # If true, treat as regex pattern
    created_at = Column(DateTime, server_default=func.now())


class AppSettings(Base):
    """Application-wide settings."""
    __tablename__ = "app_settings"
    
    id = Column(Integer, primary_key=True, default=1)
    # UI Password Protection
    password_enabled = Column(Boolean, default=False)
    password_hash = Column(String(500), default="")  # Hashed password
    # UI Options
    show_debug_menu = Column(Boolean, default=False)
    # Theme/Display
    sidebar_compact = Column(Boolean, default=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

