"""Model for saved AI analysis results."""

from sqlalchemy import Column, Integer, String, DateTime, JSON, Text
from sqlalchemy.sql import func
from app.database import Base


class SavedAnalysis(Base):
    """Store AI analysis results for later use."""
    __tablename__ = "saved_analyses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_type = Column(String(50), nullable=False)  # 'correspondents', 'tags', 'document_types'
    analysis_type = Column(String(50), default="similarity")  # 'similarity', 'nonsense', etc.
    groups = Column(JSON, nullable=False)  # The actual analysis results
    stats = Column(JSON, nullable=True)  # Token usage, etc.
    items_count = Column(Integer, default=0)  # How many items were analyzed
    groups_count = Column(Integer, default=0)  # How many groups were found
    created_at = Column(DateTime, server_default=func.now())
    
    # Track which groups have been processed
    processed_groups = Column(JSON, default=list)  # List of processed group indices

