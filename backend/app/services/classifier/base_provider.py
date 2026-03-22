"""Abstract base class for classifier providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Any


@dataclass
class ClassificationResult:
    """Result of a document classification."""
    title: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    tags_new: List[str] = field(default_factory=list)
    existing_tags: List[str] = field(default_factory=list)       # Current tags on the document
    existing_correspondent: Optional[str] = None                 # Pre-existing value from Paperless
    existing_document_type: Optional[str] = None
    existing_storage_path_id: Optional[int] = None
    existing_storage_path_name: Optional[str] = None
    correspondent: Optional[str] = None
    correspondent_is_new: bool = False
    document_type: Optional[str] = None
    storage_path_id: Optional[int] = None
    storage_path_name: Optional[str] = None
    storage_path_reason: Optional[str] = None
    created_date: Optional[str] = None
    custom_fields: Dict[str, Any] = field(default_factory=dict)
    summary: Optional[str] = None

    # Metrics
    tokens_input: int = 0
    tokens_output: int = 0
    cost_usd: float = 0.0
    duration_seconds: float = 0.0
    tool_calls_count: int = 0
    error: Optional[str] = None

    # Debug info
    debug_info: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DocumentContext:
    """All information about a document to be classified."""
    document_id: int
    current_title: str
    content: str
    current_tags: List[str] = field(default_factory=list)
    current_correspondent: Optional[str] = None
    current_document_type: Optional[str] = None
    current_storage_path: Optional[str] = None
    created_date: Optional[str] = None


class BaseClassifierProvider(ABC):
    """Abstract base for all classifier providers (OpenAI, Ollama, etc.)."""

    @abstractmethod
    async def classify(
        self,
        document: DocumentContext,
        config: Dict[str, Any],
    ) -> ClassificationResult:
        """Classify a single document. Returns proposed metadata."""
        ...

    @abstractmethod
    def get_name(self) -> str:
        """Human-readable provider name."""
        ...

    @abstractmethod
    def supports_tool_calling(self) -> bool:
        """Whether this provider supports OpenAI-style tool calling."""
        ...

    @abstractmethod
    async def test_connection(self) -> Dict[str, Any]:
        """Test if the provider is reachable and functional."""
        ...
