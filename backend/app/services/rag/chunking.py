import logging
import re
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


class ChunkingService:
    """Splits documents into chunks with metadata for embedding."""

    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 50):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk_document(self, document: Dict[str, Any]) -> List[Dict[str, Any]]:
        content = document.get("content", "") or ""
        if not content.strip():
            return []

        doc_id = document.get("id", 0)
        metadata = {
            "document_id": doc_id,
            "title": document.get("title", ""),
            "correspondent_id": document.get("correspondent", None),
            "correspondent_name": document.get("correspondent_name", ""),
            "document_type_id": document.get("document_type", None),
            "document_type_name": document.get("document_type_name", ""),
            "tags": document.get("tags", []),
            "tag_names": document.get("tag_names", []),
            "created_date": document.get("created", ""),
            "added_date": document.get("added", ""),
        }

        text_chunks = self._split_text(content)
        chunks = []
        for i, text in enumerate(text_chunks):
            chunk = {
                "id": f"doc{doc_id}_chunk{i}",
                "text": text,
                "metadata": {**metadata, "chunk_index": i, "total_chunks": len(text_chunks)},
            }
            chunks.append(chunk)
        return chunks

    def _split_text(self, text: str) -> List[str]:
        text = re.sub(r'\n{3,}', '\n\n', text).strip()
        if len(text) <= self.chunk_size:
            return [text]

        separators = ["\n\n", "\n", ". ", " "]
        return self._recursive_split(text, separators)

    def _recursive_split(self, text: str, separators: List[str]) -> List[str]:
        if not text:
            return []
        if len(text) <= self.chunk_size:
            return [text]

        sep = separators[0] if separators else " "
        remaining_seps = separators[1:] if len(separators) > 1 else [" "]

        parts = text.split(sep)
        chunks: List[str] = []
        current = ""

        for part in parts:
            candidate = f"{current}{sep}{part}" if current else part
            if len(candidate) <= self.chunk_size:
                current = candidate
            else:
                if current:
                    chunks.append(current.strip())
                if len(part) > self.chunk_size:
                    sub = self._recursive_split(part, remaining_seps)
                    chunks.extend(sub)
                    current = ""
                else:
                    current = part

        if current.strip():
            chunks.append(current.strip())

        if self.chunk_overlap > 0 and len(chunks) > 1:
            chunks = self._add_overlap(chunks)

        return chunks

    def _add_overlap(self, chunks: List[str]) -> List[str]:
        result = [chunks[0]]
        for i in range(1, len(chunks)):
            prev = chunks[i - 1]
            overlap_text = prev[-self.chunk_overlap:] if len(prev) > self.chunk_overlap else prev
            last_space = overlap_text.rfind(" ")
            if last_space > 0:
                overlap_text = overlap_text[last_space + 1:]
            result.append(f"{overlap_text} {chunks[i]}")
        return result

    def chunk_documents(self, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        all_chunks = []
        for doc in documents:
            all_chunks.extend(self.chunk_document(doc))
        return all_chunks
