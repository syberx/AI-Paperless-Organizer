"""Ollama classifier provider using Multi-Call strategy.

Since Ollama models don't support tool calling, we split the classification
into focused sequential LLM calls:
  1. Analyze: title, correspondent, date, summary
  2. Document Type: simple pick from list
  3. Tags: pick from list with context
  4. Storage Path: assign based on profiles + all context
  5. Custom Fields: extract configured values

Each call does ONE thing only -- small models work best with focused tasks.
"""

import json
import random
import time
import logging
import re
from typing import Dict, Any, List, Optional

import httpx

from app.services.classifier.base_provider import (
    BaseClassifierProvider, ClassificationResult, DocumentContext,
)
from app.services.classifier.tool_executor import ToolExecutor
from app.services.classifier.prompts import (
    SYSTEM_PROMPT_OLLAMA_ANALYZE,
    SYSTEM_PROMPT_OLLAMA_STORAGE_PATH,
    SYSTEM_PROMPT_OLLAMA_CUSTOM_FIELDS,
    SYSTEM_PROMPT_OLLAMA_VERIFY,
    RULES_TAGS,
    RULES_DOCTYPE,
    RULES_TITLE,
    RULES_CORRESPONDENT,
    RULES_DATE,
    get_correspondent_rules,
)

logger = logging.getLogger(__name__)

MAX_CONTENT_CHARS = 10000
OLLAMA_CALL_TIMEOUT = 180.0

THINKING_MODEL_PREFIXES = ("qwen3", "deepseek-r1", "qwq")

# --- JSON Schemas for structured Ollama output ---
# Forces grammar-based constrained generation – prevents models like mistral-nemo
# from returning arbitrary JSON structures that don't match the expected schema.
_SCHEMA_ANALYZE = {
    "type": "object",
    "required": ["title", "correspondent", "created_date", "summary", "language"],
    "properties": {
        "title":         {"type": ["string", "null"]},
        "correspondent": {"type": ["string", "null"]},
        "created_date":  {"type": ["string", "null"]},
        "summary":       {"type": "string"},
        "language":      {"type": "string"},
    },
    "additionalProperties": False,
}

_SCHEMA_TAGS = {
    "type": "object",
    "required": ["tags"],
    "properties": {
        "tags": {"type": "array", "items": {"type": "string"}},
    },
    "additionalProperties": False,
}

_SCHEMA_DOCTYPE = {
    "type": "object",
    "required": ["document_type"],
    "properties": {
        "document_type": {"type": ["string", "null"]},
    },
    "additionalProperties": False,
}

_SCHEMA_STORAGE_PATH = {
    "type": "object",
    "required": ["path_id", "reason"],
    "properties": {
        "path_id": {"type": ["integer", "null"]},
        "reason":  {"type": "string"},
    },
    "additionalProperties": False,
}

_SCHEMA_VERIFY = {
    "type": "object",
    "properties": {
        "storage_path_id":     {"type": ["integer", "null"]},
        "storage_path_reason": {"type": "string"},
        "tags":                {"type": "array", "items": {"type": "string"}},
        "document_type":       {"type": ["string", "null"]},
        "correspondent":       {"type": ["string", "null"]},
    },
}


class OllamaMultiCallProvider(BaseClassifierProvider):
    """Classifies documents using Ollama with sequential focused calls."""

    def __init__(
        self,
        host: str = "http://localhost:11434",
        model: str = "qwen2.5:7b",
        tool_executor: Optional[ToolExecutor] = None,
    ):
        self.host = host.rstrip("/")
        self.model = model
        self.tool_executor = tool_executor
        self._is_thinking = any(
            k in self.model.lower() for k in THINKING_MODEL_PREFIXES
        )

    def get_name(self) -> str:
        return f"Ollama ({self.model})"

    def supports_tool_calling(self) -> bool:
        return False

    async def test_connection(self) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{self.host}/api/tags")
                resp.raise_for_status()
                models = [m.get("name", "") for m in resp.json().get("models", [])]
                found = any(self.model in m or m.startswith(self.model) for m in models)
                return {"connected": True, "model_available": found, "model": self.model}
        except Exception as e:
            return {"connected": False, "error": str(e)}

    async def classify(
        self,
        document: DocumentContext,
        config: Dict[str, Any],
    ) -> ClassificationResult:
        start_time = time.time()
        total_calls = 0

        content = document.content
        original_content_len = len(content)
        if len(content) > MAX_CONTENT_CHARS:
            content = content[:MAX_CONTENT_CHARS] + "\n[... gekuerzt ...]"

        # All follow-up calls get the same full content as Call 1
        # (local Ollama = no cost, longer is fine)
        content_snippet = content

        self._total_input_tokens = 0
        self._total_output_tokens = 0

        result = ClassificationResult()
        result.debug_info["content_original_chars"] = original_content_len
        result.debug_info["content_sent_chars"] = len(content)
        result.debug_info["model"] = self.model
        result.debug_info["is_thinking"] = self._is_thinking

        # Shared across calls; populated when tags are fetched
        candidate_tags: List[str] = []
        candidate_set_lower: Dict[str, str] = {}

        try:
            # --- Call 1: Analyze (title, correspondent, date, summary) ---
            # Replace default rules with user-configured prompts when set
            analyze_prompt = SYSTEM_PROMPT_OLLAMA_ANALYZE
            if config.get("prompt_title") and config["prompt_title"].strip():
                analyze_prompt = analyze_prompt.replace(RULES_TITLE, config["prompt_title"])
            # Correspondent: user override takes priority; otherwise use trim variant if enabled
            if config.get("prompt_correspondent") and config["prompt_correspondent"].strip():
                analyze_prompt = analyze_prompt.replace(RULES_CORRESPONDENT, config["prompt_correspondent"])
            elif config.get("correspondent_trim_prompt"):
                analyze_prompt = analyze_prompt.replace(
                    RULES_CORRESPONDENT, get_correspondent_rules(trim_prompt=True)
                )
            if config.get("prompt_date") and config["prompt_date"].strip():
                analyze_prompt = analyze_prompt.replace(RULES_DATE, config["prompt_date"])

            # Build existing-metadata hint for the LLM
            existing_hints = []
            if document.current_correspondent:
                existing_hints.append(f"Korrespondent: {document.current_correspondent}")
            if document.current_document_type:
                existing_hints.append(f"Dokumenttyp: {document.current_document_type}")
            if document.current_storage_path:
                existing_hints.append(f"Speicherpfad: {document.current_storage_path}")
            if document.current_tags:
                existing_hints.append(f"Tags: {', '.join(document.current_tags)}")

            existing_block = ""
            if existing_hints:
                existing_block = (
                    "\n\nBEREITS VORHANDENE METADATEN (behalte sie wenn passend, "
                    "verbessere sie nur wenn du Besseres im Inhalt findest):\n"
                    + "\n".join(f"- {h}" for h in existing_hints)
                )

            # Extract first 3 non-empty lines as prominent header hint
            first_lines = [l.strip() for l in content.split("\n") if l.strip()][:3]
            header_hint = "\n".join(first_lines)

            analyze_user_msg = (
                f"Aktueller Titel: {document.current_title}{existing_block}"
                f"\n\n=== DOKUMENT-KOPF (WICHTIGSTE ZEILEN!) ===\n{header_hint}"
                f"\n\n--- VOLLSTAENDIGER DOKUMENTINHALT ---\n{content}"
            )

            # Retry analyze up to 3 times – thinking models sometimes return empty JSON
            analysis = ""
            analysis_data: Dict[str, Any] = {}
            for _attempt in range(3):
                analysis = await self._call_ollama(
                    analyze_prompt,
                    analyze_user_msg,
                    max_tokens=500,
                    json_schema=_SCHEMA_ANALYZE,
                )
                total_calls += 1
                analysis_data = self._parse_json(analysis)
                # Accept if we got at least a title or summary
                if analysis_data.get("title") or analysis_data.get("summary"):
                    break
                if _attempt < 2:
                    logger.warning(
                        f"Analyze call attempt {_attempt + 1} returned empty result "
                        f"(raw={repr(analysis[:100])}), retrying…"
                    )

            result.debug_info["analyze_raw_response"] = analysis[:500] if analysis else ""
            result.debug_info["analyze_attempts"] = _attempt + 1

            if config.get("enable_title", True):
                result.title = analysis_data.get("title")
            if config.get("enable_correspondent", True):
                corr = analysis_data.get("correspondent")
                # Discard obvious hallucinations: URLs, placeholder strings, suspiciously long values
                if corr and (
                    corr.startswith(("http://", "https://", "www."))
                    or len(corr) > 120
                    or "placeholder" in corr.lower()
                    or "field in the json" in corr.lower()
                ):
                    logger.warning(f"Correspondent looks like hallucination, discarding: {corr[:80]}")
                    corr = None
                result.correspondent = corr
            if config.get("enable_created_date", True):
                result.created_date = analysis_data.get("created_date")

            summary = analysis_data.get("summary") or document.current_title or ""
            result.summary = summary

            # --- Call 2: Document Type (simple, dedicated) ---
            if config.get("enable_document_type", True) and self.tool_executor:
                doc_types_data = await self.tool_executor.execute("get_document_types", {})
                doc_types = json.loads(doc_types_data)
                type_names = [dt["name"] for dt in doc_types] if doc_types else []

                if type_names:
                    dtype_prompt = (
                        f"Bestimme den Dokumenttyp anhand des folgenden Dokuments.\n\n"
                        f"EXTRAHIERTE METADATEN:\n"
                        f"- Titel: {result.title or 'unbekannt'}\n"
                        f"- Korrespondent: {result.correspondent or 'unbekannt'}\n"
                        f"- KI-Zusammenfassung: {summary}\n\n"
                        f"DOKUMENTINHALT (Anfang):\n{content_snippet}\n\n"
                        f"ENTSCHEIDUNGSREGELN:\n"
                        f"- Rechnungsnummer (RE-..., RG-..., INV-..., R-...) im Inhalt? -> 'Rechnung'\n"
                        f"- Netto/Brutto/MwSt-Angaben im Inhalt? -> 'Rechnung'\n"
                        f"- 'Zahlungseingang bestaetigt' + Rechnungsnummer? -> trotzdem 'Rechnung'\n"
                        f"- 'Bestaetigung' NUR fuer Auftrags-/Bestellbestaetigung OHNE Rechnungsnummer\n"
                        f"- Monatlicher Kontoauszug? -> 'Kontoauszug'\n"
                        f"- Vertrag/Kuendigungsschreiben? -> 'Vertrag'\n\n"
                        f"VERFUEGBARE TYPEN: {', '.join(type_names)}\n\n"
                        'Antworte als JSON: {"document_type": "Name"}'
                    )
                    # Enum-schema: model can only output a valid type name or null
                    dtype_schema = {
                        "type": "object",
                        "required": ["document_type"],
                        "properties": {
                            "document_type": {"type": ["string", "null"], "enum": type_names + [None]},
                        },
                        "additionalProperties": False,
                    }
                    dtype_response = await self._call_ollama(dtype_prompt, "", max_tokens=80, json_schema=dtype_schema)
                    total_calls += 1
                    dtype_data = self._parse_json(dtype_response)
                    if isinstance(dtype_data, dict):
                        dt = dtype_data.get("document_type") or dtype_data.get("type") or dtype_data.get("dokumenttyp")
                        if dt:
                            dt_str = str(dt).strip()
                            for tn in type_names:
                                if tn.lower() == dt_str.lower():
                                    result.document_type = tn
                                    break
                            if not result.document_type:
                                for tn in type_names:
                                    if dt_str.lower() in tn.lower() or tn.lower() in dt_str.lower():
                                        result.document_type = tn
                                        break
                    logger.info(f"DocType call: raw='{dtype_response[:100]}' -> '{result.document_type}'")

            # --- Call 3: Tags (all tags after configured exclusions) ---
            if config.get("enable_tags", True) and self.tool_executor:
                all_tags_data = await self.tool_executor.execute("search_tags", {"query": ""})
                all_tags = json.loads(all_tags_data)

                if all_tags:
                    tags_min = config.get("tags_min", 1)
                    tags_max = config.get("tags_max", 5)

                    # ToolExecutor already filtered excluded_tag_ids + exact tags_ignore.
                    # Here we additionally apply wildcard patterns from tags_ignore.
                    content_tags = list(all_tags)
                    ignore_patterns = []
                    for pat in (config.get("tags_ignore") or []):
                        if "*" in pat:
                            regex_pat = re.escape(pat).replace(r"\*", ".*")
                            ignore_patterns.append(re.compile(f"^{regex_pat}$", re.IGNORECASE))

                    if ignore_patterns:
                        before = len(content_tags)
                        content_tags = [
                            t for t in content_tags
                            if not any(p.match(t.get("name", "")) for p in ignore_patterns)
                        ]
                        logger.info(f"Wildcard ignore patterns removed {before - len(content_tags)} tags")

                    candidate_tags = [t.get("name", "") for t in content_tags]

                    logger.info(f"Tags: {len(all_tags)} total -> {len(candidate_tags)} sent to model "
                               f"(removed {len(all_tags) - len(candidate_tags)} system/ignored)")

                    result.debug_info["tags_total"] = len(all_tags)
                    result.debug_info["tags_after_blacklist"] = len(content_tags)
                    result.debug_info["tags_sent_to_model"] = candidate_tags
                    result.debug_info["summary_used"] = summary

                    # Use user-configured prompt if set, otherwise fall back to RULES_TAGS default
                    tags_rule = config.get("prompt_tags") or RULES_TAGS
                    tag_prompt = (
                        f"DOKUMENT-KONTEXT:\n"
                        f"- Titel: {result.title or 'unbekannt'}\n"
                        f"- Typ: {result.document_type or 'unbekannt'}\n"
                        f"- Korrespondent: {result.correspondent or 'unbekannt'}\n"
                        f"- KI-Zusammenfassung: {summary}\n\n"
                        f"DOKUMENTINHALT (Anfang):\n{content_snippet}\n\n"
                        f"VERFUEGBARE TAGS:\n{', '.join(candidate_tags)}\n\n"
                        f"{tags_rule}\n"
                        f"Waehle {tags_min}-{tags_max} Tags. "
                        f'Antworte als JSON: {{"tags": ["Tag1", "Tag2"]}}'
                    )

                    result.debug_info["tag_prompt_length"] = len(tag_prompt)

                    # Enum-schema: model can ONLY return tag names from candidate_tags
                    candidate_set_lower = {t.lower(): t for t in candidate_tags}
                    tags_enum_schema = {
                        "type": "object",
                        "required": ["tags"],
                        "properties": {
                            "tags": {
                                "type": "array",
                                "items": {"type": "string", "enum": candidate_tags},
                                "minItems": 0,
                                "maxItems": tags_max,
                            },
                        },
                        "additionalProperties": False,
                    }

                    tag_response = await self._call_ollama(tag_prompt, "", max_tokens=200, json_schema=tags_enum_schema)
                    total_calls += 1
                    result.debug_info["tag_raw_response"] = tag_response[:300]

                    tag_data = self._parse_json(tag_response)
                    raw_tags: List[str] = []
                    if isinstance(tag_data, dict):
                        raw_tags = tag_data.get("tags", [])
                        if not isinstance(raw_tags, list):
                            raw_tags = []
                    elif isinstance(tag_data, list):
                        raw_tags = tag_data

                    # Post-processing: keep only tags that actually exist in candidate list
                    valid_tags = []
                    for t in raw_tags:
                        if not isinstance(t, str):
                            continue
                        if t in candidate_tags:
                            valid_tags.append(t)
                        elif t.lower() in candidate_set_lower:
                            valid_tags.append(candidate_set_lower[t.lower()])
                        else:
                            logger.warning(f"Tag '{t}' not in candidate list – discarded")

                    result.tags = valid_tags
                    logger.info(f"Tags call result: {result.tags} (raw: {raw_tags})")

            # --- Call 4: Storage Path (with ALL context from previous calls) ---
            if config.get("enable_storage_path", True) and self.tool_executor:
                paths_data = await self.tool_executor.execute("get_storage_paths", {})
                paths = json.loads(paths_data)

                if paths:
                    profiles_text = "\n".join(
                        f"- ID {p['id']}: {p['name']} (Person: {p.get('person_name', '-')}, "
                        f"Typ: {p.get('type', '-')})\n  Kontext: {p.get('context_prompt', 'Kein Kontext')}"
                        for p in paths
                    )
                    path_prompt = SYSTEM_PROMPT_OLLAMA_STORAGE_PATH.format(
                        path_profiles=profiles_text,
                        title=result.title or "unbekannt",
                        summary=summary,
                        content_snippet=content_snippet,
                        correspondent=result.correspondent or "unbekannt",
                        document_type=result.document_type or "unbekannt",
                        tags=", ".join(result.tags) if result.tags else "keine",
                    )

                    result.debug_info["storage_path_profiles"] = [
                        {"id": p["id"], "name": p["name"],
                         "person": p.get("person_name", ""),
                         "type": p.get("type", ""),
                         "context": p.get("context_prompt", "")}
                        for p in paths
                    ]
                    result.debug_info["storage_path_prompt_length"] = len(path_prompt)

                    # Enum-schema: model can only pick a valid path ID (or null)
                    valid_path_ids = [p["id"] for p in paths]
                    path_enum_schema = {
                        "type": "object",
                        "required": ["path_id", "reason"],
                        "properties": {
                            "path_id": {"enum": valid_path_ids + [None]},
                            "reason":  {"type": "string"},
                        },
                        "additionalProperties": False,
                    }

                    path_response = await self._call_ollama(path_prompt, "", max_tokens=200, json_schema=path_enum_schema)
                    total_calls += 1
                    result.debug_info["storage_path_raw_response"] = path_response

                    path_data = self._parse_json(path_response)
                    if isinstance(path_data, dict):
                        raw_path_id = path_data.get("path_id")
                        # Post-processing: validate that path_id is actually in the list
                        if raw_path_id is not None and raw_path_id in valid_path_ids:
                            result.storage_path_id = raw_path_id
                        elif raw_path_id is not None:
                            logger.warning(f"path_id {raw_path_id} not in valid list {valid_path_ids} – discarded")
                        result.storage_path_reason = path_data.get("reason")

            # --- Call 5: Custom Fields ---
            if config.get("enable_custom_fields", False) and self.tool_executor:
                fields_data = await self.tool_executor.execute("get_custom_field_definitions", {})
                fields = json.loads(fields_data)

                if fields:
                    fields_text = "\n".join(
                        f"- {f['field_name']} (Typ: {f['field_type']}): {f['extraction_prompt']}"
                        + (f"\n  Beispiele: {f['example_values']}" if f.get("example_values") else "")
                        for f in fields
                    )
                    cf_prompt = SYSTEM_PROMPT_OLLAMA_CUSTOM_FIELDS.format(
                        field_definitions=fields_text,
                    )
                    cf_response = await self._call_ollama(
                        cf_prompt,
                        f"--- DOKUMENTINHALT ---\n{content[:4000]}",
                        max_tokens=400,
                    )
                    total_calls += 1
                    cf_data = self._parse_json(cf_response)
                    if isinstance(cf_data, dict):
                        result.custom_fields = cf_data

            # --- Call 6: Self-Verification (LLM reviews its own result) ---
            has_gaps = (
                (config.get("enable_storage_path") and not result.storage_path_id) or
                (config.get("enable_tags") and len(result.tags) == 0) or
                (config.get("enable_document_type") and not result.document_type) or
                (config.get("enable_correspondent") and not result.correspondent)
            )

            if has_gaps:
                logger.info(f"Verification needed: sp={result.storage_path_id}, "
                            f"tags={len(result.tags)}, dt={result.document_type}, "
                            f"corr={result.correspondent}")

                # Build storage paths text for verification
                paths_text = "Keine verfuegbar"
                if self.tool_executor:
                    try:
                        sp_data = await self.tool_executor.execute("get_storage_paths", {})
                        sp_list = json.loads(sp_data)
                        if sp_list:
                            paths_text = "\n".join(
                                f"- ID {p['id']}: {p['name']} ({p.get('type', '-')}) "
                                f"Kontext: {p.get('context_prompt', '-')}"
                                for p in sp_list
                            )
                    except Exception:
                        pass

                verify_prompt = SYSTEM_PROMPT_OLLAMA_VERIFY.format(
                    summary=summary,
                    title=result.title or "fehlt",
                    correspondent=result.correspondent or "fehlt",
                    document_type=result.document_type or "fehlt",
                    tags=", ".join(result.tags) if result.tags else "keine",
                    storage_path_id=result.storage_path_id or "null",
                    storage_path_reason=result.storage_path_reason or "fehlt",
                    created_date=result.created_date or "fehlt",
                    storage_paths=paths_text,
                )

                verify_response = await self._call_ollama(verify_prompt, "", max_tokens=300, json_schema=_SCHEMA_VERIFY)
                total_calls += 1
                verify_data = self._parse_json(verify_response)

                if isinstance(verify_data, dict) and verify_data:
                    logger.info(f"Verification corrections: {verify_data}")
                    result.debug_info["verification_corrections"] = verify_data

                    # storage_path_id: only accept if it's a valid ID from our list
                    if "storage_path_id" in verify_data and verify_data["storage_path_id"] is not None:
                        sp_id = verify_data["storage_path_id"]
                        try:
                            sp_data_v = await self.tool_executor.execute("get_storage_paths", {})
                            sp_list_v = json.loads(sp_data_v)
                            valid_sp_ids = [p["id"] for p in sp_list_v]
                        except Exception:
                            valid_sp_ids = []
                        if sp_id in valid_sp_ids:
                            result.storage_path_id = sp_id
                            result.storage_path_reason = verify_data.get(
                                "storage_path_reason", result.storage_path_reason
                            )
                        else:
                            logger.warning(f"Verification path_id {sp_id} invalid – ignored")

                    if "tags" in verify_data and isinstance(verify_data["tags"], list):
                        # Filter to only valid tags from the previously fetched candidate list
                        result.tags = [
                            candidate_set_lower[t.lower()] if t.lower() in candidate_set_lower else t
                            for t in verify_data["tags"]
                            if isinstance(t, str) and (t in candidate_tags or t.lower() in candidate_set_lower)
                        ]
                    if "document_type" in verify_data and verify_data["document_type"]:
                        result.document_type = verify_data["document_type"]
                    if "correspondent" in verify_data and verify_data["correspondent"]:
                        corr_v = verify_data["correspondent"]
                        if not (corr_v.startswith(("http://", "https://")) or len(corr_v) > 120):
                            result.correspondent = corr_v
                else:
                    logger.info("Verification: no corrections needed or empty response")
                    result.debug_info["verification_corrections"] = None

        except Exception as e:
            logger.error(f"Ollama classification failed: {e}", exc_info=True)
            result.error = str(e)

        await self._unload_model()

        result.duration_seconds = time.time() - start_time
        result.tool_calls_count = total_calls
        result.tokens_input = self._total_input_tokens
        result.tokens_output = self._total_output_tokens
        result.cost_usd = 0.0
        result.debug_info["total_tokens"] = self._total_input_tokens + self._total_output_tokens
        logger.info(f"Ollama total: {self._total_input_tokens}+{self._total_output_tokens} tokens, "
                     f"{total_calls} calls, {result.duration_seconds:.1f}s")
        return result

    async def _call_ollama(
        self, system_prompt: str, user_message: str,
        max_tokens: int = 500, keep_alive: str = "5m",
        json_schema: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Make a single Ollama call. Uses /api/generate with raw prompt for
        thinking models (bypasses chat template that triggers thinking),
        /api/chat with format=json/schema for standard models.
        """
        if self._is_thinking:
            return await self._call_ollama_generate(
                system_prompt, user_message, max_tokens, keep_alive, json_schema
            )
        return await self._call_ollama_chat(
            system_prompt, user_message, max_tokens, keep_alive, json_schema
        )

    async def _call_ollama_chat(
        self, system_prompt: str, user_message: str,
        max_tokens: int, keep_alive: str,
        json_schema: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Standard models: /api/chat with format=json or JSON schema."""
        messages = [{"role": "system", "content": system_prompt}]
        if user_message:
            messages.append({"role": "user", "content": user_message})

        # Use JSON schema if provided (Ollama >= 0.5 structured output),
        # otherwise fall back to plain "json" mode.
        fmt = json_schema if json_schema is not None else "json"

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "format": fmt,
            "keep_alive": keep_alive,
            "options": {
                "temperature": 0.1,
                "num_ctx": 16384,
                "num_predict": max_tokens,
                "seed": random.randint(1, 2**31 - 1),  # bust KV-cache on every call
            },
        }

        async with httpx.AsyncClient(timeout=OLLAMA_CALL_TIMEOUT) as client:
            try:
                resp = await client.post(f"{self.host}/api/chat", json=payload)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                # Schema enforcement not supported by this Ollama version – retry without schema
                if json_schema is not None and e.response.status_code in (400, 422):
                    logger.warning(
                        f"Ollama schema enforcement rejected (HTTP {e.response.status_code}), "
                        f"retrying without schema."
                    )
                    payload["format"] = "json"
                    resp = await client.post(f"{self.host}/api/chat", json=payload)
                    resp.raise_for_status()
                else:
                    raise

            data = resp.json()
            content = data.get("message", {}).get("content", "")

            prompt_tokens = data.get("prompt_eval_count", 0)
            completion_tokens = data.get("eval_count", 0)
            self._total_input_tokens += prompt_tokens
            self._total_output_tokens += completion_tokens

            if not content:
                logger.warning(f"Empty chat response. Keys: {list(data.get('message', {}).keys())}")

            logger.info(f"Ollama chat: {prompt_tokens}+{completion_tokens} tokens, "
                        f"{len(content)} chars: {content[:200]}")
            return content

    async def _call_ollama_generate(
        self, system_prompt: str, user_message: str,
        max_tokens: int, keep_alive: str,
        json_schema: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Thinking models: /api/generate bypasses chat template entirely.
        We construct a raw prompt that forces direct JSON output without
        triggering the model's thinking behavior.
        """
        prompt_parts = [
            "Du bist ein JSON-Extraktor. Antworte AUSSCHLIESSLICH mit validem JSON.",
            "KEIN Denkprozess, KEINE Erklaerung, KEIN Markdown -- NUR das JSON-Objekt.",
            "",
            "AUFGABE:",
            system_prompt,
        ]
        if user_message:
            prompt_parts.extend(["", "INPUT:", user_message])
        prompt_parts.extend(["", "JSON-ANTWORT:"])

        raw_prompt = "\n".join(prompt_parts)

        fmt = json_schema if json_schema is not None else "json"

        payload = {
            "model": self.model,
            "prompt": raw_prompt,
            "stream": False,
            "raw": True,
            "format": fmt,
            "keep_alive": keep_alive,
            "options": {
                "temperature": 0.1,
                "num_ctx": 16384,
                "num_predict": max(max_tokens, 1500),
                "think": False,
                "seed": random.randint(1, 2**31 - 1),  # bust KV-cache on every call
            },
        }

        async with httpx.AsyncClient(timeout=OLLAMA_CALL_TIMEOUT) as client:
            try:
                resp = await client.post(f"{self.host}/api/generate", json=payload)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                if json_schema is not None and e.response.status_code in (400, 422):
                    logger.warning(
                        f"Ollama schema enforcement rejected (HTTP {e.response.status_code}), "
                        f"retrying without schema."
                    )
                    payload["format"] = "json"
                    resp = await client.post(f"{self.host}/api/generate", json=payload)
                    resp.raise_for_status()
                else:
                    raise
            data = resp.json()
            content = data.get("response", "")

            prompt_tokens = data.get("prompt_eval_count", 0)
            completion_tokens = data.get("eval_count", 0)
            self._total_input_tokens += prompt_tokens
            self._total_output_tokens += completion_tokens

            logger.info(f"Ollama generate: {prompt_tokens}+{completion_tokens} tokens, "
                        f"raw ({len(content)} chars): {content[:300]}")

            content = self._strip_thinking_text(content)

            if not content:
                logger.warning(f"Empty generate response after stripping. "
                              f"Raw keys: {list(data.keys())}")
                raw = json.dumps(data, ensure_ascii=False)[:500]
                logger.warning(f"Raw data: {raw}")

            logger.info(f"Ollama generate cleaned ({len(content)} chars): {content[:200]}")
            return content

    def _strip_thinking_text(self, text: str) -> str:
        """Aggressively remove thinking preamble from response."""
        if not text:
            return text

        text = re.sub(r'<think>.*?</think>\s*', '', text, flags=re.DOTALL).strip()

        first_brace = text.find('{')
        first_bracket = text.find('[')

        candidates = [i for i in (first_brace, first_bracket) if i >= 0]
        if not candidates:
            return text

        json_start = min(candidates)

        if json_start > 0:
            prefix = text[:json_start].strip()
            if prefix and not prefix.startswith(('{', '[')):
                logger.info(f"Stripped {json_start} chars of thinking preamble")
                text = text[json_start:]

        return text.strip()

    async def _unload_model(self):
        """Unload model from GPU memory after classification."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    f"{self.host}/api/generate",
                    json={"model": self.model, "keep_alive": 0},
                )
                logger.info(f"Ollama model '{self.model}' unloaded from GPU")
        except Exception as e:
            logger.warning(f"Could not unload Ollama model: {e}")

    def _parse_json(self, text: str) -> Any:
        """Extract JSON from LLM response with aggressive fallbacks."""
        if not text or not text.strip():
            logger.warning("Empty text passed to _parse_json")
            return {}

        text = text.strip()

        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        text = self._strip_thinking_text(text)

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        for match in re.finditer(r'\{', text):
            candidate = text[match.start():]
            depth = 0
            end = -1
            for i, ch in enumerate(candidate):
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            if end > 0:
                try:
                    return json.loads(candidate[:end + 1])
                except json.JSONDecodeError:
                    continue

        arr_match = re.search(r'\[.*\]', text, re.DOTALL)
        if arr_match:
            try:
                return json.loads(arr_match.group(0))
            except json.JSONDecodeError:
                pass

        logger.warning(f"Could not parse JSON from Ollama response: {text[:300]}")
        return {}
