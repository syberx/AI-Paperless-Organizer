"""Persistent cache model for storing Paperless data."""

from sqlalchemy import Column, Integer, String, Text, DateTime, JSON
from sqlalchemy.sql import func
from app.database import Base


class PaperlessCache(Base):
    """Persistent cache for Paperless-ngx data."""
    __tablename__ = "paperless_cache"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    cache_key = Column(String(100), unique=True, nullable=False, index=True)
    data = Column(JSON, nullable=False)
    count = Column(Integer, default=0)  # Quick access to count without parsing JSON
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

