"""Models for OCR page-level persistence."""

from sqlalchemy import Column, Integer, String, Text, DateTime, Float
from sqlalchemy.sql import func
from app.database import Base


class OcrPageResult(Base):
    """Stores OCR result per page for resume capability and progress tracking."""
    __tablename__ = "ocr_page_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, index=True, nullable=False)
    page_number = Column(Integer, nullable=False)
    total_pages = Column(Integer, nullable=False)
    page_text = Column(Text, nullable=True)
    status = Column(String(20), default="pending")  # pending | processing | done | error
    error_message = Column(Text, nullable=True)
    attempt_count = Column(Integer, default=0)
    chars_extracted = Column(Integer, default=0)
    duration_seconds = Column(Float, default=0.0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
