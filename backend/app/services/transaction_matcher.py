"""Transaction Matcher Service — matches bank transactions to Paperless documents.

Deterministic score-based matching (not AI) with priority-weighted factors.
Used by external tools (e.g. EÜR/accounting apps) via /api/match/transaction.

Priority Scheme (additive, normalized):
  P1 = 100  Invoice number exact → immediate 100%, short-circuit
  P2 = 30   Amount exact in custom field
  P3 = 20   IBAN exact in custom field
  P4 = 15   Date within window (default ±7 days)
  P5 = 10   Customer name (fuzzy)
  P6 =  7   IBAN in OCR content
  P7 =  5   Description keywords in OCR content

Max without P1 = 87 → normalized to 100%.
"""

import logging
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

try:
    from rapidfuzz import fuzz
    _HAS_RAPIDFUZZ = True
except ImportError:
    _HAS_RAPIDFUZZ = False

logger = logging.getLogger(__name__)

MAX_WITHOUT_P1 = 87  # sum of P2..P7
AMOUNT_TOLERANCE_EUR_DEFAULT = 0.0  # exact by default
AMOUNT_TOLERANCE_PERCENT_DEFAULT = 0.0
DATE_WINDOW_DAYS_DEFAULT = 7
FUZZY_THRESHOLD_DEFAULT = 75  # 0-100, min score for customer-match


class TransactionMatcher:
    def __init__(self, paperless_client):
        self.client = paperless_client

    async def match(
        self,
        transaction: Dict[str, Any],
        *,
        date_window_days: int = DATE_WINDOW_DAYS_DEFAULT,
        amount_tolerance_eur: float = AMOUNT_TOLERANCE_EUR_DEFAULT,
        amount_tolerance_percent: float = AMOUNT_TOLERANCE_PERCENT_DEFAULT,
        fuzzy_threshold: int = FUZZY_THRESHOLD_DEFAULT,
        limit: int = 3,
    ) -> List[Dict]:
        """Find top N matching Paperless documents for a transaction."""

        booking_number = (transaction.get("bookingNumber") or "").strip()
        paypal_tx_id = (transaction.get("paypalTransactionId") or "").strip()
        paypal_invoice = (transaction.get("paypalInvoiceNumber") or "").strip()
        amount = transaction.get("amount")
        iban = (transaction.get("iban") or "").strip()
        date_str = transaction.get("date", "")
        customer = (transaction.get("customer") or "").strip()
        description = (transaction.get("description") or "").strip()

        # ────────── P1: Invoice Number exact → short-circuit 100% ──────────
        for candidate_nr in filter(None, [booking_number, paypal_invoice, paypal_tx_id]):
            docs = await self._search_custom_field("Rechnungsnummer", candidate_nr)
            if docs:
                return [self._build_match(
                    docs[0],
                    score=100,
                    confidence="high",
                    matched_on=[{
                        "field": "bookingNumber",
                        "via": "custom_field_rechnungsnummer",
                        "weight": 100,
                        "value": candidate_nr,
                    }],
                )]

        # ────────── Build candidate pool (via date window + amount) ──────────
        candidates: Dict[int, Dict] = {}  # doc_id → doc

        # Date window
        if date_str:
            try:
                base_date = datetime.strptime(date_str, "%Y-%m-%d")
                date_from = (base_date - timedelta(days=date_window_days)).strftime("%Y-%m-%d")
                date_to = (base_date + timedelta(days=date_window_days)).strftime("%Y-%m-%d")
                docs = await self._search_by_date(date_from, date_to)
                for d in docs:
                    candidates[d["id"]] = d
            except Exception as e:
                logger.warning(f"Date parsing failed: {e}")

        # If no date, fetch a broader pool by amount or customer
        if not candidates and amount is not None:
            amount_str = f"{amount:.2f}".replace(".", ",")
            docs = await self._search_custom_field("Betrag", amount_str)
            for d in docs:
                candidates[d["id"]] = d

        if not candidates and customer:
            docs = await self._search_by_correspondent(customer)
            for d in docs:
                candidates[d["id"]] = d

        if not candidates:
            logger.info("TransactionMatcher: no candidates found")
            return []

        # ────────── Score each candidate ──────────
        scored: List[Dict] = []
        for doc in candidates.values():
            score_info = await self._score_document(
                doc, transaction,
                date_window_days=date_window_days,
                amount_tolerance_eur=amount_tolerance_eur,
                amount_tolerance_percent=amount_tolerance_percent,
                fuzzy_threshold=fuzzy_threshold,
            )
            if score_info["raw_score"] > 0:
                normalized = min(100, round(score_info["raw_score"] / MAX_WITHOUT_P1 * 100))
                confidence = "high" if normalized >= 70 else ("medium" if normalized >= 40 else "low")
                scored.append(self._build_match(
                    doc,
                    score=normalized,
                    confidence=confidence,
                    matched_on=score_info["matched_on"],
                    raw_score=score_info["raw_score"],
                ))

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:limit]

    # ────────── Helpers ──────────

    async def _score_document(
        self,
        doc: Dict,
        tx: Dict,
        *,
        date_window_days: int,
        amount_tolerance_eur: float,
        amount_tolerance_percent: float,
        fuzzy_threshold: int,
    ) -> Dict:
        matched_on: List[Dict] = []
        raw_score = 0

        cf_values = self._extract_custom_fields(doc)
        content = (doc.get("content") or "").lower()

        # P2: Amount in custom field
        tx_amount = tx.get("amount")
        if tx_amount is not None:
            cf_amount = cf_values.get("betrag") or cf_values.get("gesamtbetrag") or cf_values.get("amount")
            if cf_amount and self._amount_matches(cf_amount, tx_amount, amount_tolerance_eur, amount_tolerance_percent):
                raw_score += 30
                matched_on.append({
                    "field": "amount",
                    "via": "custom_field_betrag",
                    "weight": 30,
                    "value": str(cf_amount),
                })

        # P3: IBAN in custom field
        tx_iban = (tx.get("iban") or "").strip().replace(" ", "").upper()
        if tx_iban:
            cf_iban = (cf_values.get("iban") or "").replace(" ", "").upper()
            if cf_iban and cf_iban == tx_iban:
                raw_score += 20
                matched_on.append({
                    "field": "iban",
                    "via": "custom_field_iban",
                    "weight": 20,
                    "value": tx_iban,
                })

        # P4: Date window
        tx_date_str = tx.get("date")
        doc_created = doc.get("created")
        if tx_date_str and doc_created:
            try:
                tx_date = datetime.strptime(tx_date_str, "%Y-%m-%d")
                doc_date = datetime.fromisoformat(doc_created.replace("Z", "+00:00")).replace(tzinfo=None)
                delta = abs((tx_date - doc_date).days)
                if delta <= date_window_days:
                    raw_score += 15
                    matched_on.append({
                        "field": "date",
                        "via": "created",
                        "weight": 15,
                        "delta_days": delta,
                    })
            except Exception:
                pass

        # P5: Customer name fuzzy on correspondent
        tx_customer = (tx.get("customer") or "").strip()
        corr_name = self._get_correspondent_name(doc)
        if tx_customer and corr_name:
            fuzzy_score = self._fuzzy_match(tx_customer, corr_name)
            if fuzzy_score >= fuzzy_threshold:
                raw_score += 10
                matched_on.append({
                    "field": "customer",
                    "via": "correspondent",
                    "weight": 10,
                    "fuzzy_score": fuzzy_score,
                    "value": corr_name,
                })

        # P6: IBAN in content
        if tx_iban and tx_iban.lower() in content.replace(" ", "").lower():
            raw_score += 7
            matched_on.append({
                "field": "iban",
                "via": "content",
                "weight": 7,
            })

        # P7: Description keywords in content (top 5 words)
        tx_description = (tx.get("description") or "").strip()
        if tx_description and content:
            words = [w.lower() for w in re.findall(r"\b\w{4,}\b", tx_description)][:5]
            if words:
                hits = sum(1 for w in words if w in content)
                if hits >= 2:  # at least 2 of top-5 words
                    raw_score += 5
                    matched_on.append({
                        "field": "description",
                        "via": "content",
                        "weight": 5,
                        "matched_words": hits,
                    })

        # Bonus: PayPal-Transaktions-ID in content
        paypal_tx = (tx.get("paypalTransactionId") or "").strip()
        if paypal_tx and paypal_tx in (doc.get("content") or ""):
            raw_score += 15
            matched_on.append({
                "field": "paypalTransactionId",
                "via": "content",
                "weight": 15,
            })

        return {"raw_score": raw_score, "matched_on": matched_on}

    def _fuzzy_match(self, a: str, b: str) -> int:
        if _HAS_RAPIDFUZZ:
            return int(fuzz.token_set_ratio(a.lower(), b.lower()))
        # Fallback: simple case-insensitive substring
        a_low, b_low = a.lower(), b.lower()
        if a_low in b_low or b_low in a_low:
            return 90
        # Word overlap
        aw, bw = set(a_low.split()), set(b_low.split())
        if aw and bw:
            overlap = len(aw & bw) / max(len(aw), len(bw))
            return int(overlap * 100)
        return 0

    def _amount_matches(self, cf_amount, tx_amount: float, tol_eur: float, tol_percent: float) -> bool:
        try:
            cf = float(str(cf_amount).replace(",", ".").replace("€", "").replace(" ", ""))
        except (ValueError, TypeError):
            return False
        diff = abs(cf - tx_amount)
        if tol_eur > 0 and diff <= tol_eur:
            return True
        if tol_percent > 0 and diff <= abs(tx_amount) * (tol_percent / 100):
            return True
        return diff < 0.01

    def _extract_custom_fields(self, doc: Dict) -> Dict[str, str]:
        """Return {lowercased_field_name: value} from document's custom_fields."""
        result = {}
        for cf in (doc.get("custom_fields") or []):
            # cf has: {"field": <id>, "value": "..."} but we need the name
            # The name must be resolved separately — Paperless returns field ID only here
            field_ref = cf.get("field")
            value = cf.get("value")
            if value is None:
                continue
            # We store by both id-str and hoping for name if pre-resolved
            result[str(field_ref).lower()] = str(value)
            if isinstance(field_ref, str):
                result[field_ref.lower()] = str(value)
        # Also: _field_values_resolved if enriched
        if "_field_values_resolved" in doc:
            for name, val in doc["_field_values_resolved"].items():
                if val is not None:
                    result[name.lower()] = str(val)
        return result

    def _get_correspondent_name(self, doc: Dict) -> str:
        return doc.get("_correspondent_name") or ""

    def _build_match(self, doc: Dict, *, score: int, confidence: str, matched_on: List[Dict], raw_score: int = 0) -> Dict:
        return {
            "documentId": doc["id"],
            "score": score,
            "confidence": confidence,
            "matchedOn": matched_on,
            "title": doc.get("title", ""),
            "created": doc.get("created", ""),
            "raw_score": raw_score,
        }

    async def _search_custom_field(self, field_name: str, value: str) -> List[Dict]:
        """Search Paperless documents by custom field name + value (exact)."""
        # Get all custom fields to map name→id
        fields = await self.client.get_custom_fields()
        field_id = None
        for f in fields:
            if f.get("name", "").lower() == field_name.lower():
                field_id = f.get("id")
                break
        if not field_id:
            return []

        # Paperless custom_field_query format: JSON array
        import json as _json
        query = _json.dumps([field_id, "icontains", value])
        try:
            result = await self.client._request(
                "GET", "/documents/",
                params={"custom_field_query": query, "page_size": 25}
            )
            docs = result.get("results", []) if result else []
            return await self._enrich_documents(docs)
        except Exception as e:
            logger.warning(f"custom_field_query failed for {field_name}={value}: {e}")
            return []

    async def _search_by_date(self, date_from: str, date_to: str) -> List[Dict]:
        try:
            result = await self.client._request(
                "GET", "/documents/",
                params={
                    "created__date__gte": date_from,
                    "created__date__lte": date_to,
                    "page_size": 100,
                }
            )
            docs = result.get("results", []) if result else []
            return await self._enrich_documents(docs)
        except Exception as e:
            logger.warning(f"date search failed: {e}")
            return []

    async def _search_by_correspondent(self, name: str) -> List[Dict]:
        try:
            result = await self.client._request(
                "GET", "/documents/",
                params={"correspondent__name__icontains": name, "page_size": 50}
            )
            docs = result.get("results", []) if result else []
            return await self._enrich_documents(docs)
        except Exception as e:
            logger.warning(f"correspondent search failed: {e}")
            return []

    async def _enrich_documents(self, docs: List[Dict]) -> List[Dict]:
        """Enrich with correspondent name + resolved custom field names."""
        if not docs:
            return docs
        # Load all correspondents + fields (cached)
        try:
            correspondents = await self.client.get_correspondents()
            corr_map = {c["id"]: c["name"] for c in correspondents}
        except Exception:
            corr_map = {}
        try:
            fields = await self.client.get_custom_fields()
            field_map = {f["id"]: f.get("name", "") for f in fields}
        except Exception:
            field_map = {}

        for doc in docs:
            corr_id = doc.get("correspondent")
            if corr_id and corr_id in corr_map:
                doc["_correspondent_name"] = corr_map[corr_id]
            resolved = {}
            for cf in (doc.get("custom_fields") or []):
                fid = cf.get("field")
                name = field_map.get(fid, f"field_{fid}")
                resolved[name] = cf.get("value")
            doc["_field_values_resolved"] = resolved
        return docs
