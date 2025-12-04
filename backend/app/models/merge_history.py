from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class MergeHistory(Base):
    """History of merge operations for potential rollback."""
    __tablename__ = "merge_history"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_type = Column(String(50), nullable=False)  # correspondents, tags, document_types
    target_id = Column(Integer, nullable=False)
    target_name = Column(String(500), nullable=False)
    merged_count = Column(Integer, default=0)
    documents_affected = Column(Integer, default=0)
    status = Column(String(50), default="completed")  # completed, rolled_back
    created_at = Column(DateTime, server_default=func.now())
    
    items = relationship("MergeHistoryItem", back_populates="merge_history", cascade="all, delete-orphan")


class MergeHistoryItem(Base):
    """Individual items that were merged."""
    __tablename__ = "merge_history_items"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    merge_history_id = Column(Integer, ForeignKey("merge_history.id"), nullable=False)
    source_id = Column(Integer, nullable=False)
    source_name = Column(String(500), nullable=False)
    document_ids = Column(JSON, default=list)  # List of document IDs that were updated
    
    merge_history = relationship("MergeHistory", back_populates="items")

