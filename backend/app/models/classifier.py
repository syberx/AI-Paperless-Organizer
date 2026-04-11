"""Models for the KI-Klassifizierer feature."""

from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, Float, JSON
from sqlalchemy.sql import func
from app.database import Base


class ClassifierConfig(Base):
    """Main configuration for the document classifier."""
    __tablename__ = "classifier_config"

    id = Column(Integer, primary_key=True, default=1)

    # Active provider: "openai", "mistral", "openrouter", or "ollama"
    active_provider = Column(String(50), default="openai")

    # OpenAI settings (reuses existing LLMProvider for api_key)
    openai_model = Column(String(200), default="gpt-4o-mini")

    # Mistral settings
    mistral_api_key = Column(String(500), default="")
    mistral_model = Column(String(200), default="mistral-small-latest")

    # OpenRouter settings (openai-compatible, many models)
    openrouter_api_key = Column(String(500), default="")
    openrouter_model = Column(String(200), default="mistral/mistral-small-3.1-24b-instruct")

    # Separate Ollama config (independent from OCR Ollama)
    ollama_host = Column(String(500), default="http://localhost:11434")
    ollama_model = Column(String(200), default="qwen2.5:8b")

    # Which fields to classify
    enable_title = Column(Boolean, default=True)
    enable_tags = Column(Boolean, default=True)
    enable_correspondent = Column(Boolean, default=True)
    enable_document_type = Column(Boolean, default=True)
    enable_storage_path = Column(Boolean, default=True)
    enable_created_date = Column(Boolean, default=True)
    enable_custom_fields = Column(Boolean, default=False)

    # Tag behavior: "existing_only", "suggest_new", "auto_create"
    tag_behavior = Column(String(50), default="existing_only")
    tags_min = Column(Integer, default=1)
    tags_max = Column(Integer, default=5)
    tags_keep_existing = Column(Boolean, default=True)
    # JSON array of tag names/patterns to never suggest
    tags_ignore = Column(JSON, default=[])
    # JSON array of tag names/patterns to keep when replacing (e.g. INBOX, ocr*)
    tags_protected = Column(JSON, default=[])
    # JSON array of date strings to never use as created_date (e.g. birthdays "1987-06-17")
    dates_ignore = Column(JSON, default=[])
    # Storage path assignment behavior:
    #   "always"          -- always apply AI suggestion
    #   "keep_if_set"     -- never change if document already has a path
    #   "keep_except_list"-- keep existing UNLESS current path is in override_names list
    storage_path_behavior = Column(String(50), default="always")
    # JSON array of path names that should be overridden even in keep_except_list mode
    storage_path_override_names = Column(JSON, default=["Zuweisen"])
    # Correspondent behavior: "existing_only", "suggest_new"
    correspondent_behavior = Column(String(50), default="existing_only")
    # Correspondent name trimming options
    correspondent_trim_prompt = Column(Boolean, default=False)
    correspondent_strip_legal = Column(Boolean, default=False)
    # JSON array of names to never suggest as correspondent (e.g. person names used as storage paths)
    correspondent_ignore = Column(JSON, default=[])

    # Review mode: "always", "uncertain_only", "auto_apply"
    review_mode = Column(String(50), default="always")

    # Auto-classification background job
    auto_classify_enabled = Column(Boolean, default=False)
    auto_classify_interval = Column(Integer, default=5)  # minutes
    # What to do after auto-classify: "review" (always review), "auto_apply" (apply if confident)
    auto_classify_mode = Column(String(50), default="review")
    # Tags that mark a document to be skipped entirely by auto-classification
    auto_classify_skip_tag_ids = Column(JSON, default=[])

    # Batch settings
    batch_size = Column(Integer, default=10)

    # Per-field prompt hints (user customization)
    prompt_title = Column(Text, default="")
    prompt_tags = Column(Text, default="")
    prompt_correspondent = Column(Text, default="")
    prompt_document_type = Column(Text, default="")
    prompt_date = Column(Text, default="")

    # System prompt override (optional, replaces entire base prompt)
    system_prompt = Column(Text, default="")

    # Excluded items: JSON arrays of Paperless IDs to skip
    excluded_tag_ids = Column(JSON, default=[])
    excluded_correspondent_ids = Column(JSON, default=[])
    excluded_document_type_ids = Column(JSON, default=[])

    # Classification Tag: optional tag assigned to every classified document
    classification_tag_enabled = Column(Boolean, default=False)
    classification_tag_name = Column(String(200), default="KI-klassifiziert")
    # Review Tag: optional tag assigned when document goes into review queue
    review_tag_enabled = Column(Boolean, default=False)
    review_tag_name = Column(String(200), default="KI-prüfen")
    # Tag-Ideas Tag: optional tag assigned when AI suggests new tags (tag ideas)
    tag_ideas_tag_enabled = Column(Boolean, default=False)
    tag_ideas_tag_name = Column(String(200), default="KI-tag-ideen")

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class StoragePathProfile(Base):
    """Person profile linked to a Paperless storage path."""
    __tablename__ = "classifier_storage_path_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    paperless_path_id = Column(Integer, nullable=False, unique=True)
    paperless_path_name = Column(String(500), default="")
    paperless_path_path = Column(String(500), default="")

    enabled = Column(Boolean, default=True)
    person_name = Column(String(300), default="")
    # "private" or "business"
    path_type = Column(String(50), default="private")
    context_prompt = Column(Text, default="")

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CustomFieldMapping(Base):
    """Configuration for a single Paperless custom field extraction."""
    __tablename__ = "classifier_custom_field_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    paperless_field_id = Column(Integer, nullable=False, unique=True)
    paperless_field_name = Column(String(500), default="")
    paperless_field_type = Column(String(100), default="string")

    enabled = Column(Boolean, default=False)
    extraction_prompt = Column(Text, default="")
    example_values = Column(Text, default="")
    validation_regex = Column(String(500), default="")
    ignore_values = Column(Text, default="")

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ClassificationHistory(Base):
    """Log of document classifications performed."""
    __tablename__ = "classifier_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, nullable=False)
    document_title = Column(String(500), default="")

    provider = Column(String(50), nullable=False)
    model = Column(String(200), default="")

    # What was classified
    result_json = Column(JSON, default={})
    # What was applied (may differ after review)
    applied_json = Column(JSON, nullable=True)

    # Metrics
    tokens_input = Column(Integer, default=0)
    tokens_output = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)
    duration_seconds = Column(Float, default=0.0)
    tool_calls_count = Column(Integer, default=0)

    status = Column(String(50), default="pending")  # pending, applied, rejected, error
    error_message = Column(Text, default="")

    # New tag ideas suggested by AI but not yet created
    tag_ideas = Column(JSON, default=[])

    created_at = Column(DateTime, server_default=func.now())
