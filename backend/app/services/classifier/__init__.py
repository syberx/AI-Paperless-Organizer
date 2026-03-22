"""KI-Klassifizierer: Automatic document classification for Paperless-ngx."""

from app.services.classifier.base_provider import BaseClassifierProvider, ClassificationResult
from app.services.classifier.service import DocumentClassifierService

__all__ = [
    "BaseClassifierProvider",
    "ClassificationResult",
    "DocumentClassifierService",
]
