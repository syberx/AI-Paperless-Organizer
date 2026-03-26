import json
import logging
import os
import pickle
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data")


class SearchResult:
    def __init__(self, document_id: int, title: str, snippet: str, score: float,
                 metadata: Dict[str, Any] = None, chunk_id: str = ""):
        self.document_id = document_id
        self.title = title
        self.snippet = snippet
        self.score = score
        self.metadata = metadata or {}
        self.chunk_id = chunk_id

    def to_dict(self) -> dict:
        return {
            "document_id": self.document_id,
            "title": self.title,
            "snippet": self.snippet,
            "score": round(self.score, 4),
            "metadata": self.metadata,
            "chunk_id": self.chunk_id,
        }


class SearchEngine:
    """Hybrid search: BM25 keyword + ChromaDB semantic + metadata filters."""

    def __init__(self, bm25_weight: float = 0.3, semantic_weight: float = 0.7):
        self.bm25_weight = bm25_weight
        self.semantic_weight = semantic_weight
        self._bm25 = None
        self._corpus_chunks: List[Dict[str, Any]] = []
        self._chroma_collection = None
        self._chroma_client = None

    def init_chroma(self, persist_dir: str = ""):
        import chromadb
        persist_path = persist_dir or os.path.join(DATA_DIR, "chromadb")
        os.makedirs(persist_path, exist_ok=True)
        self._chroma_client = chromadb.PersistentClient(path=persist_path)
        self._chroma_collection = self._chroma_client.get_or_create_collection(
            name="paperless_documents",
            metadata={"hnsw:space": "cosine"},
        )
        logger.info(f"ChromaDB initialized at {persist_path}, docs: {self._chroma_collection.count()}")

    def add_chunks(self, chunks: List[Dict[str, Any]], embeddings: List[List[float]],
                   rebuild_bm25: bool = True):
        if not chunks or not embeddings:
            return

        ids = [c["id"] for c in chunks]
        documents = [c["text"] for c in chunks]
        metadatas = []
        for c in chunks:
            meta = {**c["metadata"]}
            for k, v in list(meta.items()):
                if isinstance(v, list):
                    meta[k] = json.dumps(v)
                elif v is None:
                    meta[k] = ""
            metadatas.append(meta)

        batch_size = 500
        for i in range(0, len(ids), batch_size):
            end = min(i + batch_size, len(ids))
            self._chroma_collection.upsert(
                ids=ids[i:end],
                embeddings=embeddings[i:end],
                documents=documents[i:end],
                metadatas=metadatas[i:end],
            )

        self._corpus_chunks.extend(chunks)
        if rebuild_bm25:
            self._rebuild_bm25()

    def finalize_bm25(self):
        """Rebuild BM25 index once after all chunks have been added."""
        self._rebuild_bm25()
        logger.info(f"BM25 index finalized with {len(self._corpus_chunks)} chunks")

    def remove_document(self, document_id: int):
        if self._chroma_collection:
            try:
                self._chroma_collection.delete(where={"document_id": document_id})
            except Exception as e:
                logger.error(f"Error removing doc {document_id} from ChromaDB: {e}")
        self._corpus_chunks = [c for c in self._corpus_chunks if c["metadata"].get("document_id") != document_id]
        self._rebuild_bm25()

    def _rebuild_bm25(self):
        from rank_bm25 import BM25Okapi
        if not self._corpus_chunks:
            self._bm25 = None
            return
        tokenized = [self._tokenize(c["text"]) for c in self._corpus_chunks]
        self._bm25 = BM25Okapi(tokenized)
        bm25_path = os.path.join(DATA_DIR, "bm25_index.pkl")
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(bm25_path, "wb") as f:
                pickle.dump((self._bm25, self._corpus_chunks), f)
        except Exception as e:
            logger.warning(f"Could not persist BM25 index: {e}")

    def load_bm25_index(self):
        bm25_path = os.path.join(DATA_DIR, "bm25_index.pkl")
        if os.path.exists(bm25_path):
            try:
                with open(bm25_path, "rb") as f:
                    self._bm25, self._corpus_chunks = pickle.load(f)
                logger.info(f"BM25 index loaded: {len(self._corpus_chunks)} chunks")
            except Exception as e:
                logger.warning(f"Could not load BM25 index: {e}")

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        import re
        tokens = re.findall(r'\w+', text.lower())
        stopwords = {"der", "die", "das", "und", "oder", "in", "von", "zu", "mit",
                     "auf", "für", "ist", "im", "den", "des", "ein", "eine", "einer",
                     "einem", "es", "an", "als", "auch", "aus", "bei", "nach", "nicht",
                     "noch", "nur", "über", "um", "wie", "wird", "sich", "werden",
                     "the", "a", "an", "and", "or", "in", "of", "to", "with", "on",
                     "for", "is", "at", "by", "from", "not", "but", "are", "was", "be"}
        return [t for t in tokens if t not in stopwords and len(t) > 1]

    async def hybrid_search(
        self,
        query: str,
        query_embedding: List[float],
        limit: int = 5,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[SearchResult]:
        semantic_results = self._semantic_search(query_embedding, limit * 3, filters)
        bm25_results = self._bm25_search(query, limit * 3)

        if semantic_results and len(semantic_results) >= 2:
            top_scores = [r["score"] for r in semantic_results[:limit]]
            if top_scores and (max(top_scores) > 0.99 or (max(top_scores) - min(top_scores) < 0.001)):
                logger.warning(f"Semantic search returned suspicious scores (top={max(top_scores):.4f}, range={max(top_scores)-min(top_scores):.6f}) - using BM25 only")
                semantic_results = []

        merged = self._merge_results(semantic_results, bm25_results, limit)
        return merged

    def _semantic_search(
        self, embedding: List[float], limit: int, filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        if not self._chroma_collection or self._chroma_collection.count() == 0:
            return []

        where_filter = self._build_chroma_filter(filters)
        kwargs = {
            "query_embeddings": [embedding],
            "n_results": min(limit, self._chroma_collection.count()),
        }
        if where_filter:
            kwargs["where"] = where_filter

        try:
            results = self._chroma_collection.query(**kwargs)
        except Exception as e:
            logger.error(f"ChromaDB query error: {e}")
            return []

        items = []
        if results and results["ids"] and results["ids"][0]:
            for i, chunk_id in enumerate(results["ids"][0]):
                dist = results["distances"][0][i] if results.get("distances") else 0
                score = 1.0 - dist
                meta = results["metadatas"][0][i] if results.get("metadatas") else {}
                doc_text = results["documents"][0][i] if results.get("documents") else ""
                items.append({
                    "chunk_id": chunk_id,
                    "score": score,
                    "text": doc_text,
                    "metadata": meta,
                })
        return items

    def _bm25_search(self, query: str, limit: int) -> List[Dict[str, Any]]:
        if not self._bm25 or not self._corpus_chunks:
            return []

        tokens = self._tokenize(query)
        if not tokens:
            return []

        scores = self._bm25.get_scores(tokens)
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:limit]

        items = []
        max_score = max(scores) if max(scores) > 0 else 1
        for idx in top_indices:
            if scores[idx] <= 0:
                continue
            chunk = self._corpus_chunks[idx]
            items.append({
                "chunk_id": chunk["id"],
                "score": scores[idx] / max_score,
                "text": chunk["text"],
                "metadata": chunk["metadata"],
            })
        return items

    def _merge_results(
        self, semantic: List[Dict], bm25: List[Dict], limit: int
    ) -> List[SearchResult]:
        combined: Dict[str, Dict] = {}

        for item in semantic:
            cid = item["chunk_id"]
            combined[cid] = {
                **item,
                "final_score": item["score"] * self.semantic_weight,
            }

        for item in bm25:
            cid = item["chunk_id"]
            if cid in combined:
                combined[cid]["final_score"] += item["score"] * self.bm25_weight
            else:
                combined[cid] = {
                    **item,
                    "final_score": item["score"] * self.bm25_weight,
                }

        sorted_results = sorted(combined.values(), key=lambda x: x["final_score"], reverse=True)

        seen_docs = set()
        results: List[SearchResult] = []
        for item in sorted_results:
            meta = item.get("metadata", {})
            doc_id = meta.get("document_id", 0)
            if isinstance(doc_id, str):
                try:
                    doc_id = int(doc_id)
                except ValueError:
                    doc_id = 0

            results.append(SearchResult(
                document_id=doc_id,
                title=str(meta.get("title", "")),
                snippet=item.get("text", "")[:500],
                score=item["final_score"],
                metadata=meta,
                chunk_id=item.get("chunk_id", ""),
            ))

            if len(results) >= limit:
                break

        return results

    @staticmethod
    def _build_chroma_filter(filters: Optional[Dict[str, Any]]) -> Optional[Dict]:
        if not filters:
            return None

        conditions = []
        if filters.get("correspondent_id"):
            conditions.append({"correspondent_id": str(filters["correspondent_id"])})
        if filters.get("document_type_id"):
            conditions.append({"document_type_id": str(filters["document_type_id"])})

        if not conditions:
            return None
        if len(conditions) == 1:
            return conditions[0]
        return {"$and": conditions}

    @property
    def total_chunks(self) -> int:
        if self._chroma_collection:
            return self._chroma_collection.count()
        return 0
