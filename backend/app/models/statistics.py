"""Statistics tracking for cleanup operations."""

from sqlalchemy import Column, Integer, String, DateTime, JSON
from sqlalchemy.sql import func
from app.database import Base


class CleanupStatistics(Base):
    """Track cleanup operations and savings."""
    __tablename__ = "cleanup_statistics"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_type = Column(String(50), nullable=False)  # correspondents, tags, document_types
    operation = Column(String(50), nullable=False)  # merge, delete, cleanup
    items_before = Column(Integer, default=0)
    items_after = Column(Integer, default=0)
    items_affected = Column(Integer, default=0)  # How many items were merged/deleted
    documents_affected = Column(Integer, default=0)  # How many documents were updated
    details = Column(JSON, nullable=True)  # Additional details like names
    created_at = Column(DateTime, server_default=func.now())


class DailyStats(Base):
    """Daily aggregated statistics."""
    __tablename__ = "daily_stats"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String(10), nullable=False, unique=True)  # YYYY-MM-DD
    
    # Counts at end of day
    correspondents_total = Column(Integer, default=0)
    tags_total = Column(Integer, default=0)
    document_types_total = Column(Integer, default=0)
    
    # Operations this day
    correspondents_merged = Column(Integer, default=0)
    correspondents_deleted = Column(Integer, default=0)
    tags_merged = Column(Integer, default=0)
    tags_deleted = Column(Integer, default=0)
    document_types_merged = Column(Integer, default=0)
    document_types_deleted = Column(Integer, default=0)
    
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

