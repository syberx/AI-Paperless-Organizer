from sqlalchemy import Column, Integer, String, DateTime, JSON, Text
from sqlalchemy.sql import func
from app.database import Base


class MatchLog(Base):
    """Rolling log of transaction match requests (last 30 entries)."""
    __tablename__ = "match_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)
    api_key_name = Column(String(200), default="")
    transaction_summary = Column(String(500), default="")  # short human-readable
    request_json = Column(JSON, default=dict)
    matches_count = Column(Integer, default=0)
    top_score = Column(Integer, default=0)  # best match score 0-100
    top_doc_id = Column(Integer, nullable=True)
    duration_ms = Column(Integer, default=0)
