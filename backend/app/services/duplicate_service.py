"""Duplicate detection service for Paperless-ngx documents.

Three scan levels:
1. Exact duplicates (checksum matching)
2. Similar documents (ChromaDB embedding cosine similarity)
3. Invoice duplicates (LLM-based invoice number + amount extraction)
"""

import asyncio
import json
import logging
import os
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Optional, Set, Tuple

import httpx
from sqlalchemy import select as sa_select, text

from app.database import async_session
from app.models.duplicates import DuplicateInvoiceCache
from app.models.rag import RagConfig
from app.services.ollama_lock import acquire as ollama_acquire, release as ollama_release

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")


# ---------------------------------------------------------------------------
# Scan state (module-level, for background job status)
# ---------------------------------------------------------------------------

_scan_state: Dict = {
    "running": False,
    "phase": "",       # "exact", "similar", "invoices", "done"
    "progress": 0,
    "total": 0,
    "results": {
        "exact": [],   # [{"checksum": "...", "documents": [{id, title, created, correspondent_name}]}]
        "similar": [],  # [{"similarity": 0.95, "documents": [...]}]
        "invoices": [], # [{"invoice_number": "...", "amount": "...", "documents": [...]}]
    },
    "error": None,
}


def get_scan_state() -> Dict:
    return _scan_state


# ---------------------------------------------------------------------------
# Main service
# ---------------------------------------------------------------------------

class DuplicateService:

    async def scan_all(self, modes: List[str], similarity_threshold: float = 0.92):
        """Run selected scan modes as a background task.

        Args:
            modes: list that can include 'exact', 'similar', 'invoices'
            similarity_threshold: cosine similarity threshold for similar scan (default 0.92)
        """
        global _scan_state

        if _scan_state["running"]:
            logger.warning("Duplicate scan already running, ignoring request")
            return

        _scan_state["running"] = True
        _scan_state["phase"] = ""
        _scan_state["progress"] = 0
        _scan_state["total"] = 0
        _scan_state["results"] = {"exact": [], "similar": [], "invoices": []}
        _scan_state["error"] = None

        try:
            # Build a PaperlessClient from DB settings
            pl_client = await self._get_paperless_client()

            if "exact" in modes:
                _scan_state["phase"] = "exact"
                _scan_state["progress"] = 0
                _scan_state["results"]["exact"] = await self.scan_exact(pl_client)

            if "similar" in modes:
                _scan_state["phase"] = "similar"
                _scan_state["progress"] = 0
                _scan_state["results"]["similar"] = await self.scan_similar(similarity_threshold)

            if "invoices" in modes:
                _scan_state["phase"] = "invoices"
                _scan_state["progress"] = 0
                _scan_state["results"]["invoices"] = await self.scan_invoices(pl_client)

            _scan_state["phase"] = "done"
            logger.info("Duplicate scan completed successfully")

        except Exception as e:
            logger.exception("Duplicate scan failed")
            _scan_state["error"] = str(e)
        finally:
            _scan_state["running"] = False

    # ------------------------------------------------------------------
    # Stufe 1: Exakte Duplikate (checksum)
    # ------------------------------------------------------------------

    async def scan_exact(self, pl_client) -> List[Dict]:
        """Group documents by SHA256 checksum. Groups with >1 doc are exact duplicates."""
        global _scan_state

        logger.info("Starting exact duplicate scan (checksum)")
        documents = await pl_client.get_documents(page_size=100)
        _scan_state["total"] = len(documents)
        logger.info(f"Loaded {len(documents)} documents for checksum scan")

        # Build lookup maps for correspondent names
        corr_map = await self._build_correspondent_map(pl_client)

        # Group by checksum
        checksum_groups: Dict[str, List[Dict]] = defaultdict(list)
        for i, doc in enumerate(documents):
            _scan_state["progress"] = i + 1
            checksum = doc.get("checksum") or doc.get("archive_checksum") or ""
            if not checksum:
                continue
            corr_id = doc.get("correspondent")
            checksum_groups[checksum].append({
                "id": doc["id"],
                "title": doc.get("title", ""),
                "created": doc.get("created", ""),
                "correspondent_name": corr_map.get(corr_id, "") if corr_id else "",
            })

        # Filter to groups with more than 1 document
        results = []
        for checksum, docs in checksum_groups.items():
            if len(docs) > 1:
                results.append({
                    "checksum": checksum,
                    "documents": docs,
                })

        logger.info(f"Exact scan found {len(results)} duplicate groups")
        return results

    # ------------------------------------------------------------------
    # Stufe 2: Ähnliche Dokumente (ChromaDB Embeddings)
    # ------------------------------------------------------------------

    async def scan_similar(self, similarity_threshold: float = 0.92) -> List[Dict]:
        """Find similar documents via ChromaDB embeddings (cosine similarity)."""
        global _scan_state
        import chromadb

        logger.info(f"Starting similar document scan (threshold={similarity_threshold})")

        # Distance threshold: cosine distance = 1 - similarity
        distance_threshold = 1.0 - similarity_threshold

        persist_path = os.path.join(DATA_DIR, "chromadb")
        if not os.path.exists(persist_path):
            logger.warning("ChromaDB directory not found, skipping similar scan")
            return []

        chroma_client = chromadb.PersistentClient(path=persist_path)
        try:
            collection = chroma_client.get_collection(
                name="paperless_documents",
                # metadata={"hnsw:space": "cosine"},  # already set at creation
            )
        except Exception:
            logger.warning("ChromaDB collection 'paperless_documents' not found, skipping similar scan")
            return []

        # Get all embeddings for chunk_index=0 only
        all_data = collection.get(
            include=["embeddings", "metadatas"],
            where={"chunk_index": 0},
        )

        ids = all_data.get("ids", [])
        embeddings = all_data.get("embeddings", [])
        metadatas = all_data.get("metadatas", [])

        if not ids or not embeddings:
            logger.info("No embeddings found in ChromaDB for similar scan")
            return []

        _scan_state["total"] = len(ids)
        logger.info(f"Querying {len(ids)} document embeddings for similarity")

        # Find similar pairs
        similar_pairs: List[Tuple[int, int, float]] = []  # (doc_id_a, doc_id_b, similarity)
        seen_pairs: Set[Tuple[int, int]] = set()

        # Build metadata lookup
        doc_meta: Dict[int, Dict] = {}
        for i, meta in enumerate(metadatas):
            doc_id = meta.get("document_id")
            if doc_id is not None:
                doc_meta[doc_id] = {
                    "id": int(doc_id),
                    "title": meta.get("title", ""),
                    "chunk_id": ids[i],
                }

        for i, embedding in enumerate(embeddings):
            _scan_state["progress"] = i + 1
            doc_id_a = metadatas[i].get("document_id")
            if doc_id_a is None:
                continue
            doc_id_a = int(doc_id_a)

            # Query for similar documents
            results = collection.query(
                query_embeddings=[embedding],
                n_results=min(6, len(ids)),
                where={"chunk_index": 0},
            )

            if not results or not results.get("ids") or not results["ids"][0]:
                continue

            result_ids = results["ids"][0]
            distances = results["distances"][0] if results.get("distances") else []
            result_metas = results["metadatas"][0] if results.get("metadatas") else []

            for j, (rid, dist) in enumerate(zip(result_ids, distances)):
                doc_id_b = result_metas[j].get("document_id") if j < len(result_metas) else None
                if doc_id_b is None:
                    continue
                doc_id_b = int(doc_id_b)

                # Skip self-match
                if doc_id_a == doc_id_b:
                    continue

                # Check distance threshold
                if dist > distance_threshold:
                    continue

                # Deduplicate pairs (A,B) == (B,A)
                pair = (min(doc_id_a, doc_id_b), max(doc_id_a, doc_id_b))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)

                similarity = round(1.0 - dist, 4)
                similar_pairs.append((doc_id_a, doc_id_b, similarity))

            # Yield control periodically
            if i % 50 == 0:
                await asyncio.sleep(0)

        # Group connected pairs into clusters
        clusters = self._cluster_pairs(similar_pairs)

        # Build result groups with document info
        results = []
        for cluster_doc_ids, avg_similarity in clusters:
            docs = []
            for did in cluster_doc_ids:
                meta = doc_meta.get(did)
                if meta:
                    docs.append({
                        "id": did,
                        "title": meta.get("title", ""),
                        "created": "",
                        "correspondent_name": "",
                    })
                else:
                    docs.append({
                        "id": did,
                        "title": f"Dokument #{did}",
                        "created": "",
                        "correspondent_name": "",
                    })
            results.append({
                "similarity": avg_similarity,
                "documents": docs,
            })

        logger.info(f"Similar scan found {len(results)} groups")
        return results

    def _cluster_pairs(self, pairs: List[Tuple[int, int, float]]) -> List[Tuple[List[int], float]]:
        """Group connected pairs into clusters using Union-Find.

        Returns list of (doc_id_list, average_similarity).
        """
        if not pairs:
            return []

        parent: Dict[int, int] = {}

        def find(x: int) -> int:
            if x not in parent:
                parent[x] = x
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a: int, b: int):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

        # Build union-find from pairs
        for doc_a, doc_b, _ in pairs:
            union(doc_a, doc_b)

        # Group by root
        cluster_members: Dict[int, List[int]] = defaultdict(list)
        cluster_sims: Dict[int, List[float]] = defaultdict(list)
        all_docs = set()
        for doc_a, doc_b, sim in pairs:
            all_docs.add(doc_a)
            all_docs.add(doc_b)

        for doc_id in all_docs:
            root = find(doc_id)
            if doc_id not in cluster_members[root]:
                cluster_members[root].append(doc_id)

        for doc_a, doc_b, sim in pairs:
            root = find(doc_a)
            cluster_sims[root].append(sim)

        results = []
        for root, members in cluster_members.items():
            if len(members) > 1:
                sims = cluster_sims.get(root, [0.0])
                avg_sim = round(sum(sims) / len(sims), 4) if sims else 0.0
                results.append((sorted(members), avg_sim))

        return results

    # ------------------------------------------------------------------
    # Stufe 3: Rechnungs-Duplikate (LLM-Extraktion)
    # ------------------------------------------------------------------

    async def scan_invoices(self, pl_client) -> List[Dict]:
        """Find duplicate invoices by extracting invoice number + amount via LLM."""
        global _scan_state

        logger.info("Starting invoice duplicate scan")

        # Load all documents
        documents = await pl_client.get_documents(page_size=100)

        # Load document types to resolve type names
        doc_types = await pl_client.get_document_types()
        type_map: Dict[int, str] = {dt["id"]: dt.get("name", "") for dt in doc_types}

        # Filter for invoices
        invoice_docs = []
        for doc in documents:
            type_id = doc.get("document_type")
            type_name = type_map.get(type_id, "") if type_id else ""
            if type_name.lower() in ("rechnung", "invoice"):
                invoice_docs.append(doc)

        if not invoice_docs:
            logger.info("No invoice documents found, skipping invoice scan")
            return []

        _scan_state["total"] = len(invoice_docs)
        logger.info(f"Found {len(invoice_docs)} invoice documents to analyze")

        # Build correspondent map
        corr_map = await self._build_correspondent_map(pl_client)

        # Load LLM config
        chat_model = await self._get_chat_model()
        ollama_url = await self._get_ollama_url()

        # Load cached extractions
        cached: Dict[int, Dict] = {}
        async with async_session() as db:
            rows = (await db.execute(
                sa_select(DuplicateInvoiceCache)
            )).scalars().all()
            for row in rows:
                cached[row.document_id] = {
                    "invoice_number": row.invoice_number,
                    "amount": row.amount,
                }

        # Extract invoice data
        extractions: Dict[int, Dict] = {}  # doc_id -> {invoice_number, amount}

        for i, doc in enumerate(invoice_docs):
            _scan_state["progress"] = i + 1
            doc_id = doc["id"]

            # Use cache if available
            if doc_id in cached:
                extractions[doc_id] = cached[doc_id]
                continue

            # Extract via LLM
            content = doc.get("content", "") or ""
            if not content.strip():
                continue

            # Truncate content to avoid huge prompts
            content_trimmed = content[:3000]

            extraction = await self._extract_invoice_data(
                content_trimmed, chat_model, ollama_url
            )
            if extraction:
                extractions[doc_id] = extraction
                # Cache result
                await self._cache_extraction(doc_id, extraction)

        # Group by invoice_number
        number_groups: Dict[str, List[Dict]] = defaultdict(list)
        for doc in invoice_docs:
            doc_id = doc["id"]
            ext = extractions.get(doc_id)
            if not ext or not ext.get("invoice_number"):
                continue
            corr_id = doc.get("correspondent")
            number_groups[ext["invoice_number"]].append({
                "id": doc_id,
                "title": doc.get("title", ""),
                "created": doc.get("created", ""),
                "correspondent_name": corr_map.get(corr_id, "") if corr_id else "",
                "amount": ext.get("amount", ""),
            })

        # Filter: only groups where number AND amount match, and >1 doc
        results = []
        for inv_number, docs in number_groups.items():
            if len(docs) < 2:
                continue
            # Sub-group by amount
            amount_groups: Dict[str, List[Dict]] = defaultdict(list)
            for d in docs:
                amount_key = (d.get("amount") or "").strip().lower()
                amount_groups[amount_key].append(d)

            for amount_val, amount_docs in amount_groups.items():
                if len(amount_docs) > 1:
                    results.append({
                        "invoice_number": inv_number,
                        "amount": amount_val,
                        "documents": amount_docs,
                    })

        logger.info(f"Invoice scan found {len(results)} duplicate groups")
        return results

    async def _extract_invoice_data(
        self, content: str, model: str, ollama_url: str
    ) -> Optional[Dict]:
        """Extract invoice number and amount from document content via Ollama."""
        got = await ollama_acquire("duplicates", timeout=120)
        if not got:
            logger.warning("Could not acquire OllamaLock for invoice extraction")
            return None

        try:
            prompt = (
                "Extrahiere aus dem folgenden Dokumenttext die Rechnungsnummer und den Gesamtbetrag.\n"
                "Antworte NUR mit einem JSON-Objekt im Format:\n"
                '{"invoice_number": "...", "amount": "..."}\n'
                "Wenn du keine Rechnungsnummer findest, setze den Wert auf einen leeren String.\n"
                "Wenn du keinen Betrag findest, setze den Wert auf einen leeren String.\n\n"
                f"Dokumenttext:\n{content}"
            )

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{ollama_url}/api/chat",
                    json={
                        "model": model,
                        "messages": [
                            {"role": "user", "content": prompt}
                        ],
                        "stream": False,
                        "options": {
                            "temperature": 0,
                            "num_ctx": 4096,
                        },
                    },
                )
                response.raise_for_status()
                data = response.json()

            reply = data.get("message", {}).get("content", "")

            # Parse JSON from reply
            return self._parse_invoice_json(reply)

        except Exception as e:
            logger.error(f"Invoice extraction failed: {e}")
            return None
        finally:
            ollama_release("duplicates")

    def _parse_invoice_json(self, text: str) -> Optional[Dict]:
        """Try to extract a JSON object from LLM response text."""
        # Try direct parse
        try:
            obj = json.loads(text.strip())
            if isinstance(obj, dict):
                return {
                    "invoice_number": str(obj.get("invoice_number", "")).strip(),
                    "amount": str(obj.get("amount", "")).strip(),
                }
        except json.JSONDecodeError:
            pass

        # Try to find JSON in text
        import re
        match = re.search(r'\{[^}]+\}', text)
        if match:
            try:
                obj = json.loads(match.group())
                if isinstance(obj, dict):
                    return {
                        "invoice_number": str(obj.get("invoice_number", "")).strip(),
                        "amount": str(obj.get("amount", "")).strip(),
                    }
            except json.JSONDecodeError:
                pass

        logger.warning(f"Could not parse invoice JSON from LLM response: {text[:200]}")
        return None

    async def _cache_extraction(self, doc_id: int, extraction: Dict):
        """Save extraction result to SQLite cache."""
        async with async_session() as db:
            # Upsert: delete old, insert new
            await db.execute(
                text("DELETE FROM duplicate_invoice_cache WHERE document_id = :doc_id"),
                {"doc_id": doc_id},
            )
            cache_entry = DuplicateInvoiceCache(
                document_id=doc_id,
                invoice_number=extraction.get("invoice_number", ""),
                amount=extraction.get("amount", ""),
            )
            db.add(cache_entry)
            await db.commit()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _get_paperless_client(self):
        """Create a PaperlessClient from DB settings."""
        from app.models import PaperlessSettings
        from app.services.paperless_client import PaperlessClient

        async with async_session() as db:
            result = await db.execute(
                sa_select(PaperlessSettings).where(PaperlessSettings.id == 1)
            )
            settings = result.scalar_one_or_none()

        if settings and settings.is_configured:
            return PaperlessClient(
                base_url=settings.url,
                api_token=settings.api_token,
            )
        raise ValueError("Paperless-ngx is not configured")

    async def _build_correspondent_map(self, pl_client) -> Dict[int, str]:
        """Build a {id: name} map of correspondents."""
        correspondents = await pl_client.get_correspondents()
        return {c["id"]: c.get("name", "") for c in correspondents}

    async def _get_chat_model(self) -> str:
        """Get the configured chat model from RagConfig."""
        async with async_session() as db:
            result = await db.execute(
                sa_select(RagConfig).where(RagConfig.id == 1)
            )
            config = result.scalar_one_or_none()
        if config and config.chat_model:
            return config.chat_model
        return "qwen3.5:4b"

    async def _get_ollama_url(self) -> str:
        """Get the configured Ollama URL from RagConfig."""
        async with async_session() as db:
            result = await db.execute(
                sa_select(RagConfig).where(RagConfig.id == 1)
            )
            config = result.scalar_one_or_none()
        if config and config.ollama_base_url:
            return config.ollama_base_url.rstrip("/")
        return "http://host.docker.internal:11434"

    async def get_document_types(self, pl_client) -> List[Dict]:
        """Proxy to PaperlessClient.get_document_types()."""
        return await pl_client.get_document_types()
