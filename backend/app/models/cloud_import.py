from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


class CloudSource(Base):
    """A cloud storage source to monitor and import from."""
    __tablename__ = "cloud_sources"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, default="Neue Quelle")
    source_type = Column(String(50), default="webdav")  # webdav, rclone, local
    enabled = Column(Boolean, default=True)
    poll_interval_minutes = Column(Integer, default=5)

    # WebDAV connection
    webdav_url = Column(String(500), default="")
    webdav_username = Column(String(200), default="")
    webdav_password = Column(Text, default="")
    webdav_path = Column(String(500), default="/")

    # rclone connection
    rclone_remote = Column(String(100), default="")
    rclone_path = Column(String(500), default="/")
    rclone_config = Column(Text, default="")  # content of rclone.conf for this remote

    # Local folder
    local_path = Column(String(1000), default="")

    # Import settings for Paperless
    filename_prefix = Column(String(100), default="")
    paperless_tag_ids = Column(Text, default="[]")  # JSON array of tag IDs
    paperless_correspondent_id = Column(Integer, nullable=True)
    paperless_document_type_id = Column(Integer, nullable=True)
    after_import_action = Column(String(20), default="keep")  # keep, delete

    # Status
    last_checked_at = Column(DateTime, nullable=True)
    last_status = Column(String(50), default="idle")  # idle, syncing, error
    last_error = Column(Text, default="")
    files_imported = Column(Integer, default=0)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CloudImportLog(Base):
    """Log of imported files per source."""
    __tablename__ = "cloud_import_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_id = Column(Integer, nullable=False, index=True)
    source_name = Column(String(200), default="")
    file_path = Column(String(1000), nullable=False)
    file_name = Column(String(500), nullable=False)
    paperless_doc_id = Column(Integer, nullable=True)
    import_status = Column(String(20), default="success")  # success, error, skipped
    error_message = Column(Text, default="")
    imported_at = Column(DateTime, server_default=func.now())
