import uuid
from sqlalchemy import Column, Integer, String, Boolean, Text, Float, DateTime
from sqlalchemy.sql import func
from app.database import Base


def _generate_uuid():
    return str(uuid.uuid4())


class RagConfig(Base):
    """RAG system configuration."""
    __tablename__ = "rag_config"

    id = Column(Integer, primary_key=True, default=1)
    embedding_provider = Column(String(100), default="ollama")
    embedding_model = Column(String(200), default="mxbai-embed-large")
    ollama_base_url = Column(String(500), default="http://localhost:11434")
    chunk_size = Column(Integer, default=500)
    chunk_overlap = Column(Integer, default=50)
    bm25_weight = Column(Float, default=0.3)
    semantic_weight = Column(Float, default=0.7)
    max_sources = Column(Integer, default=8)
    max_context_tokens = Column(Integer, default=4000)
    chat_model_provider = Column(String(100), default="ollama")
    chat_model = Column(String(200), default="qwen3.5:4b")
    chat_system_prompt = Column(Text, default="Du bist ein hilfreicher Assistent, der Fragen zu Dokumenten beantwortet. Antworte basierend auf dem bereitgestellten Kontext. Wenn du die Antwort nicht im Kontext findest, sage das ehrlich.")
    auto_index_enabled = Column(Boolean, default=False)
    auto_index_interval = Column(Integer, default=30)
    query_rewrite_enabled = Column(Boolean, default=True)
    contextual_retrieval_enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RagChatSession(Base):
    """A chat session / conversation."""
    __tablename__ = "rag_chat_sessions"

    id = Column(String(36), primary_key=True, default=_generate_uuid)
    title = Column(String(500), default="Neuer Chat")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RagChatMessage(Base):
    """A single message in a chat session."""
    __tablename__ = "rag_chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    sources = Column(Text, default="[]")  # JSON array of source references
    created_at = Column(DateTime, server_default=func.now())


class RagIndexingState(Base):
    """Tracks the current state of RAG document indexing."""
    __tablename__ = "rag_indexing_state"

    id = Column(Integer, primary_key=True, default=1)
    status = Column(String(50), default="idle")  # idle, indexing, completed, error
    total_documents = Column(Integer, default=0)
    indexed_documents = Column(Integer, default=0)
    last_indexed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, default="")
    indexed_doc_ids = Column(Text, default="[]")  # JSON array of indexed Paperless doc IDs
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ApiKey(Base):
    """API keys for external access to RAG endpoints."""
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    key_hash = Column(String(128), nullable=False, unique=True)
    key_prefix = Column(String(10), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    last_used_at = Column(DateTime, nullable=True)
