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
                    loaded = pickle.load(f)
                _, self._corpus_chunks = loaded
                # Always rebuild BM25 from raw corpus so stopword changes take effect
                self._rebuild_bm25()
                logger.info(f"BM25 index loaded + rebuilt: {len(self._corpus_chunks)} chunks")
            except Exception as e:
                logger.warning(f"Could not load BM25 index: {e}")

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        import re
        tokens = re.findall(r'\w+', text.lower())
        stopwords = {
            # Deutsche Artikel
            "der", "die", "das", "dem", "den", "des",
            # Deutsche Konjunktionen / Partikeln
            "und", "oder", "aber", "doch", "denn", "wenn", "weil", "dass", "ob",
            "also", "noch", "nur", "schon", "ja", "nein", "doch", "mal", "eben",
            # Deutsche Präpositionen
            "in", "von", "zu", "mit", "auf", "für", "an", "bei", "nach", "über",
            "um", "aus", "durch", "gegen", "ohne", "unter", "vor", "zwischen",
            "im", "am", "zum", "zur", "beim",
            # Deutsche Pronomen / Possessivpronomen
            "ich", "du", "er", "sie", "es", "wir", "ihr",
            "mein", "meine", "meiner", "meinem", "meines",
            "dein", "deine", "deiner", "deinem", "deines",
            "sein", "seine", "seiner", "seinem", "seines",
            "ihr", "ihre", "ihrer", "ihrem", "ihres",
            "unser", "unsere", "unserer", "unserem", "unseres",
            "euer", "eure", "eurer", "eurem", "eures",
            "dieser", "diese", "dieses", "diesem", "diesen",
            "jeder", "jede", "jedes", "jedem", "jeden",
            "kein", "keine", "keiner", "keinem", "keines",
            # Deutsche Hilfsverben / häufige Verben
            "ist", "war", "wird", "wurde", "worden", "sein", "haben", "hatte",
            "sind", "waren", "werden", "hat", "wird", "sei", "wäre", "hätte",
            "kann", "konnte", "darf", "soll", "will", "muss", "mag",
            # Sonstiges
            "als", "wie", "so", "da", "hier", "dort", "nicht", "sich",
            "auch", "noch", "schon", "sehr", "mehr", "viel", "alle",
            "eine", "einer", "einem", "eines", "ein",
            # Englische Stopwörter
            "the", "a", "and", "or", "in", "of", "to", "with", "on",
            "for", "is", "at", "by", "from", "not", "but", "are", "was", "be",
            "this", "that", "it", "as", "an",
        }
        # Keep 3+ char words; also keep 2+ digit numbers (so "17", "03" in dates survive)
        return [t for t in tokens if t not in stopwords and (len(t) > 2 or (len(t) >= 2 and t.isdigit()))]

    async def hybrid_search(
        self,
        query: str,
        query_embedding: List[float],
        limit: int = 5,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[SearchResult]:
        # Fetch more candidates for better recall; BM25 uses doc-level aggregation internally
        fetch_k = limit * 10
        semantic_results = self._semantic_search(query_embedding, fetch_k, filters)
        bm25_results = self._bm25_search(query, fetch_k)

        if semantic_results and len(semantic_results) >= 2:
            top_scores = [r["score"] for r in semantic_results[:limit]]
            if top_scores and (max(top_scores) > 0.99 or (max(top_scores) - min(top_scores) < 0.001)):
                logger.warning(f"Semantic scores suspicious (top={max(top_scores):.4f}) - using BM25 only")
                semantic_results = []

        merged = self._rrf_merge(semantic_results, bm25_results, limit)
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
        """BM25 search with document-level score aggregation.
        Sums the top-3 chunk scores per document so that documents where
        multiple chunks partially match outrank documents with a single lucky chunk."""
        if not self._bm25 or not self._corpus_chunks:
            return []

        tokens = self._tokenize(query)
        if not tokens:
            return []

        scores = self._bm25.get_scores(tokens)
        max_raw = max(scores) if max(scores) > 0 else 1

        # Aggregate at document level: collect all chunk scores per doc
        doc_buckets: Dict[int, Dict] = {}
        for idx, raw_score in enumerate(scores):
            if raw_score <= 0:
                continue
            chunk = self._corpus_chunks[idx]
            doc_id = chunk["metadata"].get("document_id", 0)
            if doc_id not in doc_buckets:
                doc_buckets[doc_id] = {"chunk_scores": [], "best_chunk": None, "best_raw": -1}
            doc_buckets[doc_id]["chunk_scores"].append(raw_score)
            if raw_score > doc_buckets[doc_id]["best_raw"]:
                doc_buckets[doc_id]["best_raw"] = raw_score
                doc_buckets[doc_id]["best_chunk"] = chunk

        # Score = sum of top-3 chunks (normalized by max_raw so scores stay comparable)
        doc_agg = {}
        for doc_id, data in doc_buckets.items():
            top3 = sorted(data["chunk_scores"], reverse=True)[:3]
            doc_agg[doc_id] = {
                "score": sum(top3) / max_raw,
                "chunk": data["best_chunk"],
            }

        sorted_docs = sorted(doc_agg.items(), key=lambda x: x[1]["score"], reverse=True)[:limit]

        items = []
        for doc_id, data in sorted_docs:
            chunk = data["chunk"]
            items.append({
                "chunk_id": chunk["id"],
                "score": data["score"],
                "text": chunk["text"],
                "metadata": chunk["metadata"],
            })
        return items

    @staticmethod
    def _dedup_by_document(results: List[Dict]) -> List[Dict]:
        """Keep only the best chunk per document_id, preserving rank order."""
        seen = set()
        deduped = []
        for item in results:
            doc_id = item.get("metadata", {}).get("document_id", 0)
            if doc_id in seen:
                continue
            seen.add(doc_id)
            deduped.append(item)
        return deduped

    def _rrf_merge(
        self, semantic: List[Dict], bm25: List[Dict], limit: int,
        k: int = 20, bm25_boost: float = 2.0
    ) -> List[SearchResult]:
        """Weighted Reciprocal Rank Fusion at document level.
        BM25 gets a higher weight (bm25_boost) because keyword matches
        are more reliable for specific factual queries in German documents."""
        # Semantic results still need dedup (chunk-level from ChromaDB)
        sem_dedup = self._dedup_by_document(semantic)
        # BM25 results are already aggregated at document level
        bm25_dedup = bm25

        doc_data: Dict[int, Dict] = {}
        doc_scores: Dict[int, float] = {}

        for rank, item in enumerate(sem_dedup):
            doc_id = item.get("metadata", {}).get("document_id", 0)
            doc_scores[doc_id] = doc_scores.get(doc_id, 0) + 1.0 / (k + rank + 1)
            if doc_id not in doc_data:
                doc_data[doc_id] = item

        for rank, item in enumerate(bm25_dedup):
            doc_id = item.get("metadata", {}).get("document_id", 0)
            doc_scores[doc_id] = doc_scores.get(doc_id, 0) + bm25_boost / (k + rank + 1)
            if doc_id not in doc_data or item["score"] > doc_data.get(doc_id, {}).get("score", 0):
                doc_data[doc_id] = item

        sorted_docs = sorted(doc_scores.items(), key=lambda x: x[1], reverse=True)
        max_rrf = max(s for _, s in sorted_docs) if sorted_docs else 1.0

        results: List[SearchResult] = []
        for doc_id, rrf_score in sorted_docs[:limit]:
            item = doc_data[doc_id]
            meta = item.get("metadata", {})
            if isinstance(doc_id, str):
                try:
                    doc_id = int(doc_id)
                except ValueError:
                    doc_id = 0

            results.append(SearchResult(
                document_id=doc_id,
                title=str(meta.get("title", "")),
                snippet=item.get("text", "")[:500],
                score=round(rrf_score / max_rrf, 4),
                metadata=meta,
                chunk_id=item.get("chunk_id", ""),
            ))

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
