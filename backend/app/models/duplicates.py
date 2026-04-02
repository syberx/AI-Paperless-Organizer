from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.database import Base


class DuplicateIgnore(Base):
    """A pair of document IDs that the user marked as 'not a duplicate'."""
    __tablename__ = "duplicate_ignores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id_a = Column(Integer, nullable=False)
    doc_id_b = Column(Integer, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class DuplicateInvoiceCache(Base):
    """Cached invoice extraction results (number + amount) per document."""
    __tablename__ = "duplicate_invoice_cache"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, nullable=False, unique=True, index=True)
    invoice_number = Column(String(200), default="")
    amount = Column(String(100), default="")
    extracted_at = Column(DateTime, server_default=func.now())
