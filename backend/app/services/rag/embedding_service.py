import asyncio
import logging
import httpx
from typing import List

logger = logging.getLogger(__name__)


EMBEDDING_DIMS = {
    "nomic-embed-text": 768,
    "mxbai-embed-large": 1024,
    "all-minilm": 384,
    # German-optimised models (recommended upgrade)
    "jina/jina-embeddings-v2-base-de": 768,   # ollama pull jina/jina-embeddings-v2-base-de
    "jina-embeddings-v2-base-de": 768,
    "bge-m3": 1024,                            # ollama pull bge-m3
}
DEFAULT_DIM = 768


class EmbeddingService:
    """Generates text embeddings via Ollama or OpenAI."""

    def __init__(
        self,
        provider: str = "ollama",
        model: str = "mxbai-embed-large",
        ollama_base_url: str = "http://localhost:11434",
        openai_api_key: str = "",
    ):
        self.provider = provider
        self.model = model
        self.ollama_base_url = ollama_base_url.rstrip("/")
        self.openai_api_key = openai_api_key
        self.dim = EMBEDDING_DIMS.get(model, DEFAULT_DIM)

    async def generate(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        if self.provider == "openai":
            return await self._openai_embed(texts)
        return await self._ollama_embed(texts)

    # Most Ollama embedding models (mxbai-embed-large, nomic-embed-text) cap at 512 tokens.
    # 512 tokens * ~1.5 chars/token for German OCR text ≈ 768 chars. Use 750 to be safe.
    _MAX_EMBED_CHARS = 750

    async def _ollama_embed(self, texts: List[str]) -> List[List[float]]:
        url = f"{self.ollama_base_url}/api/embed"
        all_embeddings: List[List[float]] = []
        batch_size = 50

        async with httpx.AsyncClient(timeout=300.0) as client:
            for i in range(0, len(texts), batch_size):
                batch = [t[:self._MAX_EMBED_CHARS] if len(t) > self._MAX_EMBED_CHARS else t
                         for t in texts[i:i + batch_size]]
                for attempt in range(3):
                    try:
                        resp = await client.post(url, json={
                            "model": self.model,
                            "input": batch,
                        })
                        resp.raise_for_status()
                        data = resp.json()
                        embeddings = data.get("embeddings", [])
                        if len(embeddings) == len(batch):
                            all_embeddings.extend(embeddings)
                        else:
                            logger.error(f"Batch {i}: expected {len(batch)} embeddings, got {len(embeddings)}")
                            all_embeddings.extend(embeddings)
                            all_embeddings.extend([[0.0] * self.dim] * (len(batch) - len(embeddings)))
                        break
                    except httpx.HTTPStatusError as e:
                        body = ""
                        try:
                            body = e.response.text[:300]
                        except Exception:
                            pass
                        if attempt < 2:
                            logger.warning(f"Embedding batch {i} attempt {attempt+1} failed: {e} | response: {body}")
                            await asyncio.sleep(2 ** attempt)
                        else:
                            logger.error(f"Embedding batch {i} failed after 3 attempts: {e} | response: {body}")
                            all_embeddings.extend([[0.0] * self.dim] * len(batch))
                    except Exception as e:
                        if attempt < 2:
                            logger.warning(f"Embedding batch {i} attempt {attempt+1} failed: {e}")
                            await asyncio.sleep(2 ** attempt)
                        else:
                            logger.error(f"Embedding batch {i} failed after 3 attempts: {e}")
                            all_embeddings.extend([[0.0] * self.dim] * len(batch))

        return all_embeddings

    async def _openai_embed(self, texts: List[str]) -> List[List[float]]:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=self.openai_api_key)
        try:
            response = await client.embeddings.create(
                model=self.model or "text-embedding-3-small",
                input=texts,
            )
            return [item.embedding for item in response.data]
        except Exception as e:
            logger.error(f"OpenAI embedding error: {e}")
            return [[0.0] * 1536] * len(texts)

    async def check_health(self) -> dict:
        if self.provider == "ollama":
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(f"{self.ollama_base_url}/api/tags")
                    resp.raise_for_status()
                    models = [m["name"] for m in resp.json().get("models", [])]
                    model_available = any(self.model in m for m in models)
                    return {"healthy": True, "model_available": model_available, "models": models}
            except Exception as e:
                return {"healthy": False, "error": str(e)}
        return {"healthy": True, "provider": "openai"}
