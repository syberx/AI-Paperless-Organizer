import logging
import re
import unicodedata
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

# Short-document threshold: below this word count the metadata header is doubled
# to compensate for sparse OCR content (e.g. Taufurkunden, old certificates)
_SHORT_DOC_WORD_THRESHOLD = 150


class ChunkingService:
    """Splits documents into chunks with metadata for embedding."""

    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 50):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    @staticmethod
    def _preprocess_ocr(text: str) -> str:
        """Clean common OCR artifacts before chunking.

        Fixes line-break hyphens, broken words, ligatures and stray whitespace
        that are typical in scanned German documents.
        """
        # 1. Unicode normalisation – converts ligatures (ﬁ→fi, ﬀ→ff) and
        #    full-width chars to their ASCII equivalents
        text = unicodedata.normalize("NFKC", text)
        # 2. Repair soft/line-break hyphens: "Ge-\nburts" → "Geburts"
        text = re.sub(r"-\n\s*", "", text)
        # 3. Join broken words: lowercase → newline → lowercase (OCR line-wrap)
        text = re.sub(r"([a-zäöüß])\n([a-zäöüß])", r"\1 \2", text)
        # 4. Remove stray single non-word characters on their own line (scan artifacts)
        text = re.sub(r"(?m)^\s*[^\w\s]\s*$", "", text)
        # 5. Collapse runs of 2+ spaces within a line (keep newlines intact)
        text = re.sub(r"(?<!\n) {2,}(?!\n)", " ", text)
        # 6. Collapse triple+ newlines (already done later, but cleaner here too)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        return text

    @staticmethod
    def _build_metadata_header(document: Dict[str, Any]) -> str:
        """Build a searchable metadata header prepended to every chunk."""
        parts = []
        title = document.get("title", "").strip()
        if title:
            parts.append(f"Titel: {title}")
        corr = document.get("correspondent_name", "").strip()
        if corr:
            parts.append(f"Korrespondent: {corr}")
        doc_type = document.get("document_type_name", "").strip()
        if doc_type:
            parts.append(f"Dokumententyp: {doc_type}")
        tag_names = [t for t in document.get("tag_names", []) if t.strip()]
        if tag_names:
            parts.append(f"Tags: {', '.join(tag_names)}")
        storage = document.get("storage_path_name", "").strip()
        if storage:
            parts.append(f"Speicherpfad: {storage}")
        created = document.get("created", "").strip()
        if created:
            parts.append(f"Datum: {created[:10]}")
        return "\n".join(parts)

    def chunk_document(self, document: Dict[str, Any]) -> List[Dict[str, Any]]:
        content = document.get("content", "") or ""
        if not content.strip():
            return []

        # Clean OCR artifacts before chunking
        content = self._preprocess_ocr(content)

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
            "storage_path": document.get("storage_path", None),
            "storage_path_name": document.get("storage_path_name", ""),
            "created_date": document.get("created", ""),
            "added_date": document.get("added", ""),
        }

        header = self._build_metadata_header(document)
        is_short_doc = len(content.split()) < _SHORT_DOC_WORD_THRESHOLD
        text_chunks = self._split_text(content)
        chunks = []
        for i, text in enumerate(text_chunks):
            # Only first chunk gets full header; subsequent chunks get title only to save tokens.
            # Short documents (e.g. Taufurkunden) get a doubled header so the metadata
            # signal dominates the embedding and improves retrieval for sparse OCR text.
            if i == 0:
                if header and is_short_doc:
                    chunk_text = f"{header}\n{header}\n\n{text}"
                elif header:
                    chunk_text = f"{header}\n\n{text}"
                else:
                    chunk_text = text
            else:
                title_line = f"Titel: {document.get('title', '')}\n" if document.get("title") else ""
                chunk_text = f"{title_line}{text}" if title_line else text
            chunk = {
                "id": f"doc{doc_id}_chunk{i}",
                "text": chunk_text,
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
