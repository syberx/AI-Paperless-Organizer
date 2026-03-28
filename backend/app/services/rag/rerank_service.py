"""Cross-Encoder Reranking Service.

After initial hybrid retrieval (BM25 + semantic), a cross-encoder re-reads
every (query, document) pair together. Unlike bi-encoders that embed query
and document separately, a cross-encoder has full attention between both –
giving true semantic relevance scores rather than keyword frequency scores.

Model used: ml6team/cross-encoder-mmarco-german-distilbert-base
- Trained on German MMARCO (machine-translated MS MARCO)
- ~268 MB, Apache 2.0 license
- Runs on CPU, no GPU required
- ~2-5 seconds for 30 pairs on a typical server CPU
"""

import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# German cross-encoder: small, fast, specifically trained for German retrieval
RERANK_MODEL = "ml6team/cross-encoder-mmarco-german-distilbert-base"

# Cache directory inside Docker container (mapped to a volume for persistence)
HF_CACHE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "data", "hf_cache"
)


class RerankService:
    """Singleton cross-encoder reranker. Lazy-loads model on first use."""

    _instance: Optional["RerankService"] = None
    _model = None
    _model_loaded = False

    def __new__(cls) -> "RerankService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _load_model(self) -> bool:
        if self._model_loaded:
            return self._model is not None
        self._model_loaded = True
        try:
            from sentence_transformers import CrossEncoder

            os.makedirs(HF_CACHE_DIR, exist_ok=True)
            os.environ.setdefault("HF_HOME", HF_CACHE_DIR)
            os.environ.setdefault("TRANSFORMERS_CACHE", HF_CACHE_DIR)
            logger.info(f"Loading cross-encoder reranker: {RERANK_MODEL}")
            self._model = CrossEncoder(RERANK_MODEL, cache_folder=HF_CACHE_DIR)
            logger.info("Cross-encoder reranker ready")
            return True
        except Exception as e:
            logger.error(f"Could not load cross-encoder reranker: {e}")
            self._model = None
            return False

    def rerank(
        self,
        query: str,
        results: List[Dict[str, Any]],
        text_key: str = "snippet",
        max_text_len: int = 1500,
    ) -> List[Dict[str, Any]]:
        """Re-score and re-sort results using the cross-encoder.

        Args:
            query: The user's natural language question.
            results: List of dicts. Each must have `text_key` with the document text.
            text_key: Which field holds the text to score against.
            max_text_len: Truncate text to this length (cross-encoder has a token limit).

        Returns:
            Same list, re-sorted by cross-encoder relevance score (highest first).
            Each item gains a 'rerank_score' float field.
        """
        if not results:
            return results

        if not self._load_model() or self._model is None:
            logger.warning("Reranker unavailable – keeping original order")
            return results

        try:
            texts = [str(r.get(text_key, ""))[:max_text_len] for r in results]
            pairs = [(query, t) for t in texts]
            scores = self._model.predict(pairs)

            for r, score in zip(results, scores):
                r["rerank_score"] = float(score)

            reranked = sorted(results, key=lambda x: x.get("rerank_score", 0.0), reverse=True)
            top = reranked[0] if reranked else None
            if top:
                logger.debug(
                    f"Reranker top result: {top.get('title', '?')} "
                    f"(score={top.get('rerank_score', 0):.3f})"
                )
            return reranked
        except Exception as e:
            logger.error(f"Reranking failed: {e}")
            return results
