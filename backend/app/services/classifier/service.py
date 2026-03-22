"""Main classifier service that orchestrates document classification."""

import logging
import re
from typing import Dict, Any, Optional, List
from dataclasses import asdict

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.classifier import (
    ClassifierConfig, StoragePathProfile, CustomFieldMapping, ClassificationHistory,
)
from app.models import LLMProvider
from app.services.paperless_client import PaperlessClient
from app.services.classifier.base_provider import (
    BaseClassifierProvider, ClassificationResult, DocumentContext,
)
from app.services.classifier.openai_provider import OpenAIToolCallingProvider
from app.services.classifier.ollama_provider import OllamaMultiCallProvider
from app.services.classifier.tool_executor import ToolExecutor

logger = logging.getLogger(__name__)

# ── Legal form stripping ───────────────────────────────────────────────────────
# Ordered longest-first so "GmbH & Co. KG" is matched before "GmbH" or "KG"
_LEGAL_FORMS = [
    r"GmbH\s*&\s*Co\.?\s*KGaA",
    r"GmbH\s*&\s*Co\.?\s*KG",
    r"GmbH\s*&\s*Co\.?",
    r"AG\s*&\s*Co\.?\s*KG",
    r"UG\s*\(haftungsbeschr[äa]nkt\)",
    r"GmbH",
    r"AG",
    r"KGaA",
    r"KG",
    r"OHG",
    r"GbR",
    r"e\.?\s*V\.?",
    r"e\.?\s*G\.?",
    r"e\.?\s*K\.?",
    r"SE",
    r"UG",
    r"mbH",
    r"Ltd\.?",
    r"Inc\.?",
    r"Corp\.?",
    r"P\.?L\.?C\.?",
    r"SARL",
    r"S\.?\s*A\.?",
    r"N\.?\s*V\.?",
    r"B\.?\s*V\.?",
    r"i\.?\s*Gr\.?",      # in Gründung
    r"i\.?\s*L\.?",       # in Liquidation
]
_LEGAL_SUFFIX_RE = re.compile(
    r"[\s,]+(" + "|".join(_LEGAL_FORMS) + r")\s*$",
    re.IGNORECASE,
)


def _strip_legal_forms(name: str) -> str:
    """Remove German/international legal form suffixes from a company name."""
    if not name:
        return name
    # Apply up to 3 times to strip chained suffixes like "GmbH & Co. KG"
    for _ in range(3):
        stripped = _LEGAL_SUFFIX_RE.sub("", name).strip(" ,.")
        if stripped == name:
            break
        name = stripped
    return name.strip()


# Reference indicators that legitimise a YYYY-NNNNN number in a title.
_TITLE_REF_INDICATORS = re.compile(
    r"\b(?:Nr|Re|Ref|Rechnung|Auftrag|Aktenzeichen|Vertrags?|AZ|Az)\s*[-.:]\s*$",
    re.IGNORECASE,
)
# Matches "YYYY-NNNNN" style numbers (year-personalnumber) in titles.
_TITLE_YEAR_ID_RE = re.compile(r"\b((?:19|20)\d{2})-(\d{4,6})\b")


def _clean_title(title: str, created_date: str = None) -> str:
    """Minimal safety net: remove obvious personal-number patterns from titles.

    Only removes "YYYY-NNNNN" patterns that are NOT preceded by a reference
    keyword (Nr., Re-, Rechnung, ...). Everything else is left to the LLM.
    """
    if not title:
        return title

    def _replace_fake_ref(m: re.Match) -> str:
        before = title[: m.start()].rstrip()
        if _TITLE_REF_INDICATORS.search(before):
            return m.group(0)  # keep — it's a real reference number
        return ""  # remove the entire YYYY-NNNNN pattern

    cleaned = _TITLE_YEAR_ID_RE.sub(_replace_fake_ref, title)
    cleaned = re.sub(r"  +", " ", cleaned).strip(" -,.")
    return cleaned


class DocumentClassifierService:
    """Orchestrates document classification using the configured provider."""

    def __init__(self, db: AsyncSession, paperless: PaperlessClient):
        self.db = db
        self.paperless = paperless

    async def get_config(self) -> ClassifierConfig:
        result = await self.db.execute(
            select(ClassifierConfig).where(ClassifierConfig.id == 1)
        )
        config = result.scalar_one_or_none()
        if not config:
            config = ClassifierConfig(id=1)
            self.db.add(config)
            await self.db.commit()
            await self.db.refresh(config)
        return config

    async def save_config(self, data: Dict[str, Any]) -> ClassifierConfig:
        config = await self.get_config()
        for key, value in data.items():
            if hasattr(config, key) and key not in ("id", "created_at", "updated_at"):
                setattr(config, key, value)
        await self.db.commit()
        await self.db.refresh(config)
        return config

    async def get_storage_profiles(self) -> List[StoragePathProfile]:
        result = await self.db.execute(
            select(StoragePathProfile).order_by(StoragePathProfile.person_name)
        )
        return list(result.scalars().all())

    async def save_storage_profile(self, data: Dict[str, Any]) -> StoragePathProfile:
        path_id = data.get("paperless_path_id")
        result = await self.db.execute(
            select(StoragePathProfile).where(
                StoragePathProfile.paperless_path_id == path_id
            )
        )
        profile = result.scalar_one_or_none()
        if not profile:
            profile = StoragePathProfile(paperless_path_id=path_id)
            self.db.add(profile)

        for key, value in data.items():
            if hasattr(profile, key) and key not in ("id", "created_at", "updated_at"):
                setattr(profile, key, value)

        await self.db.commit()
        await self.db.refresh(profile)
        return profile

    async def get_custom_field_mappings(self) -> List[CustomFieldMapping]:
        result = await self.db.execute(
            select(CustomFieldMapping).order_by(CustomFieldMapping.paperless_field_name)
        )
        return list(result.scalars().all())

    async def save_custom_field_mapping(self, data: Dict[str, Any]) -> CustomFieldMapping:
        field_id = data.get("paperless_field_id")
        result = await self.db.execute(
            select(CustomFieldMapping).where(
                CustomFieldMapping.paperless_field_id == field_id
            )
        )
        mapping = result.scalar_one_or_none()
        if not mapping:
            mapping = CustomFieldMapping(paperless_field_id=field_id)
            self.db.add(mapping)

        for key, value in data.items():
            if hasattr(mapping, key) and key not in ("id", "created_at", "updated_at"):
                setattr(mapping, key, value)

        await self.db.commit()
        await self.db.refresh(mapping)
        return mapping

    def _build_tool_executor(
        self, config: ClassifierConfig,
        storage_profiles: list, field_mappings: list,
    ) -> ToolExecutor:
        return ToolExecutor(
            paperless=self.paperless,
            storage_profiles=storage_profiles,
            custom_field_mappings=field_mappings,
            excluded_tag_ids=config.excluded_tag_ids or [],
            excluded_correspondent_ids=config.excluded_correspondent_ids or [],
            excluded_document_type_ids=config.excluded_document_type_ids or [],
            tags_ignore=config.tags_ignore or [],
        )

    async def _build_provider(self, config: ClassifierConfig) -> BaseClassifierProvider:
        """Build the appropriate provider based on config."""
        storage_profiles = await self.get_storage_profiles()
        field_mappings = await self.get_custom_field_mappings()
        tool_executor = self._build_tool_executor(config, storage_profiles, field_mappings)

        if config.active_provider == "openai":
            api_key = await self._get_openai_key()
            if not api_key:
                raise ValueError("OpenAI API key not configured. Set it in LLM Provider settings.")
            return OpenAIToolCallingProvider(
                api_key=api_key,
                model=config.openai_model,
                tool_executor=tool_executor,
            )
        elif config.active_provider == "mistral":
            api_key = getattr(config, "mistral_api_key", "") or ""
            if not api_key:
                raise ValueError("Mistral API key not configured. Set it in Classifier settings.")
            return OpenAIToolCallingProvider(
                api_key=api_key,
                model=getattr(config, "mistral_model", "mistral-small-latest"),
                tool_executor=tool_executor,
                base_url="https://api.mistral.ai/v1",
                provider_label="Mistral",
            )
        elif config.active_provider == "ollama":
            return OllamaMultiCallProvider(
                host=config.ollama_host,
                model=config.ollama_model,
                tool_executor=tool_executor,
            )
        else:
            raise ValueError(f"Unknown provider: {config.active_provider}")

    async def _get_openai_key(self) -> Optional[str]:
        result = await self.db.execute(
            select(LLMProvider).where(LLMProvider.name == "openai")
        )
        provider = result.scalar_one_or_none()
        return provider.api_key if provider and provider.api_key else None

    def _build_config_dict(self, config: ClassifierConfig) -> Dict[str, Any]:
        return {
            "enable_title": config.enable_title,
            "enable_tags": config.enable_tags,
            "enable_correspondent": config.enable_correspondent,
            "enable_document_type": config.enable_document_type,
            "enable_storage_path": config.enable_storage_path,
            "enable_created_date": config.enable_created_date,
            "enable_custom_fields": config.enable_custom_fields,
            "tag_behavior": config.tag_behavior,
            "tags_min": config.tags_min or 1,
            "tags_max": config.tags_max or 5,
            "correspondent_behavior": config.correspondent_behavior,
            "prompt_title": config.prompt_title or "",
            "prompt_tags": config.prompt_tags or "",
            "prompt_correspondent": config.prompt_correspondent or "",
            "prompt_document_type": config.prompt_document_type or "",
            "prompt_date": config.prompt_date or "",
            "system_prompt": config.system_prompt,
            "tags_ignore": config.tags_ignore or [],
            "storage_path_behavior": getattr(config, "storage_path_behavior", "always") or "always",
            "storage_path_override_names": getattr(config, "storage_path_override_names", ["Zuweisen"]) or ["Zuweisen"],
            "correspondent_trim_prompt": bool(getattr(config, "correspondent_trim_prompt", False)),
            "correspondent_strip_legal": bool(getattr(config, "correspondent_strip_legal", False)),
        }

    async def _build_document_context(self, document_id: int) -> tuple:
        """Build DocumentContext + raw doc_data from Paperless. Returns (context, doc_data) or raises."""
        doc_data = await self.paperless.get_document(document_id)
        if not doc_data:
            return None, None

        all_tags = await self.paperless.get_tags(use_cache=True)
        tag_map = {t["id"]: t["name"] for t in all_tags}
        current_tag_names = [tag_map.get(tid, str(tid)) for tid in doc_data.get("tags", [])]

        all_correspondents = await self.paperless.get_correspondents(use_cache=True)
        corr_map = {c["id"]: c["name"] for c in all_correspondents}
        current_corr = corr_map.get(doc_data.get("correspondent"), None)

        all_types = await self.paperless.get_document_types(use_cache=True)
        type_map = {dt["id"]: dt["name"] for dt in all_types}
        current_type = type_map.get(doc_data.get("document_type"), None)

        all_paths = await self.paperless.get_storage_paths(use_cache=True)
        path_map = {p["id"]: p["name"] for p in all_paths}
        current_path_id = doc_data.get("storage_path")
        current_path_name = path_map.get(current_path_id) if current_path_id else None

        document = DocumentContext(
            document_id=document_id,
            current_title=doc_data.get("title", ""),
            content=doc_data.get("content", ""),
            current_tags=current_tag_names,
            current_correspondent=current_corr,
            current_document_type=current_type,
            current_storage_path=current_path_name,
            created_date=doc_data.get("created"),
        )
        return document, doc_data

    def _normalize_date(self, date_str: str) -> Optional[str]:
        """Normalize various date formats to YYYY-MM-DD for comparison."""
        if not date_str:
            return None
        date_str = date_str.strip()
        # Already ISO: 1987-06-17
        if re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
            return date_str
        # German DD.MM.YYYY
        m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", date_str)
        if m:
            return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
        # German DD.MM.YY
        m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{2})$", date_str)
        if m:
            year = int(m.group(3))
            year = 2000 + year if year < 50 else 1900 + year
            return f"{year}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
        return None

    def _normalize_custom_fields(self, custom_fields: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize custom field values to consistent formats regardless of LLM output."""
        if not custom_fields:
            return custom_fields

        normalized = {}
        for key, value in custom_fields.items():
            if value is None:
                normalized[key] = None
                continue

            val = str(value).strip()

            if not val or val.lower() in ("null", "none", "n/a", "-", "--", "nicht gefunden", "nicht vorhanden"):
                normalized[key] = None
                continue

            key_lower = key.lower()

            if any(k in key_lower for k in ("iban", "kontonummer", "konto")):
                cleaned = re.sub(r'[\s\-\.]+', '', val)
                if re.match(r'^[A-Z]{2}\d', cleaned, re.IGNORECASE):
                    val = cleaned.upper()
                elif re.sub(r'\D', '', cleaned):
                    val = cleaned
                else:
                    normalized[key] = None
                    continue

            elif any(k in key_lower for k in ("betrag", "summe", "gesamt", "preis", "kosten")):
                val = re.sub(r'[€$\s]', '', val)
                val = val.replace('\u00a0', '')
                if re.match(r'^\d{1,3}(\.\d{3})+(,\d{1,2})?$', val):
                    val = val.replace('.', '').replace(',', '.')
                elif re.match(r'^\d{1,3}(\.\d{3})+$', val):
                    val = val.replace('.', '')
                elif ',' in val and '.' not in val:
                    val = val.replace(',', '.')
                try:
                    normalized[key] = round(float(val), 2)
                    continue
                except ValueError:
                    pass

            normalized[key] = val

        return normalized

    def _build_protected_matchers(self, config) -> list:
        """Build regex matchers from tags_protected patterns."""
        matchers = []
        for pat in (config.tags_protected or []):
            if "*" in pat:
                regex_pat = re.escape(pat).replace(r"\*", ".*")
                matchers.append(("regex", re.compile(f"^{regex_pat}$", re.IGNORECASE)))
            else:
                matchers.append(("exact", pat.lower()))
        return matchers

    def _is_tag_protected(self, tag_name: str, matchers: list) -> bool:
        """Check if a tag matches any protected pattern."""
        for kind, matcher in matchers:
            if kind == "exact" and tag_name.lower() == matcher:
                return True
            elif kind == "regex" and matcher.match(tag_name):
                return True
        return False

    def _deduplicate_tags(self, tags: List[str]) -> List[str]:
        """Remove redundant tags where one is a substring of another."""
        if len(tags) <= 1:
            return tags
        result = []
        sorted_tags = sorted(tags, key=len)
        for i, tag in enumerate(sorted_tags):
            is_redundant = False
            for j, other in enumerate(sorted_tags):
                if i == j:
                    continue
                if len(tag) < len(other) and tag.lower() in other.lower():
                    is_redundant = True
                    break
                if tag.lower() == other.lower() and i < j:
                    is_redundant = True
                    break
            if not is_redundant:
                result.append(tag)
        return result

    def _build_context_words(self, result: ClassificationResult, doc_content: str = "") -> set:
        """Build a set of context words from all available document info."""
        words = set()
        for source in [result.title, result.correspondent, result.summary]:
            if source:
                words.update(w.lower() for w in re.split(r'[\s,.\-/]+', source) if len(w) > 3)
        if result.document_type:
            words.add(result.document_type.lower())
        if doc_content:
            snippet = doc_content[:3000].lower()
            words.update(w for w in re.split(r'[\s,.\-/]+', snippet) if len(w) > 4)
        return words

    def _matches_ignore_patterns(self, tag: str, config: 'ClassifierConfig') -> bool:
        """Check if a tag matches any configured ignore pattern (exact or wildcard)."""
        tag_lower = tag.lower().strip()
        for pat in (config.tags_ignore or []):
            if "*" in pat:
                regex_pat = re.escape(pat).replace(r"\*", ".*")
                if re.match(f"^{regex_pat}$", tag, re.IGNORECASE):
                    return True
            elif pat.lower() == tag_lower:
                return True
        return False

    def _verify_result_coherence(
        self, result: ClassificationResult, config: ClassifierConfig,
        doc_content: str = "",
    ):
        """Verify result coherence. Removes system tags, enforces tag limits,
        and uses relevance scoring to decide which tags to keep."""
        tags_max = config.tags_max or 5

        issues = []
        if config.enable_document_type and not result.document_type:
            issues.append("document_type is empty")
        if config.enable_correspondent and not result.correspondent:
            issues.append("correspondent is empty")
        if config.enable_title and not result.title:
            issues.append("title is empty")
        if issues:
            logger.warning(f"Verification: missing fields: {', '.join(issues)}")

        if result.tags:
            before_count = len(result.tags)
            result.tags = [t for t in result.tags if not self._matches_ignore_patterns(t, config)]
            removed_ignore = before_count - len(result.tags)
            if removed_ignore:
                logger.info(f"Verification: removed {removed_ignore} tags via ignore patterns")

            result.tags = self._deduplicate_tags(result.tags)
            tags_min = config.tags_min or 1
            context_words = self._build_context_words(result, doc_content)

            def _tag_score(tag: str) -> int:
                tag_lower = tag.lower()
                tag_words = set(re.split(r'[\s\-/]+', tag_lower))
                score = 0
                for tw in tag_words:
                    if len(tw) < 3:
                        continue
                    for cw in context_words:
                        if tw in cw or cw in tw:
                            score += 2
                            break
                if result.title and tag_lower in result.title.lower():
                    score += 3
                if result.summary and tag_lower in result.summary.lower():
                    score += 3
                if doc_content and tag_lower in doc_content[:4000].lower():
                    score += 5
                return score

            # Remove tags with zero relevance to document content (if enough tags remain)
            if doc_content or result.title or result.summary:
                scored = [(t, _tag_score(t)) for t in result.tags]
                relevant = [(t, s) for t, s in scored if s > 0]
                irrelevant = [t for t, s in scored if s == 0]
                if irrelevant and len(relevant) >= tags_min:
                    logger.info(f"Verification: removed {len(irrelevant)} irrelevant tags (score=0): {irrelevant}")
                    result.tags = [t for t, _ in relevant]

            # Score and trim if still over limit
            if len(result.tags) > tags_max:
                scored_tags = [(t, _tag_score(t)) for t in result.tags]
                scored_tags.sort(key=lambda x: x[1], reverse=True)
                removed = [t for t, _ in scored_tags[tags_max:]]
                logger.info(f"Trimming {len(result.tags)} tags to max {tags_max}, removed: {removed}")
                result.tags = [t for t, _ in scored_tags[:tags_max]]

        logger.info(f"Verification complete: tags={result.tags}, doc_type={result.document_type}, "
                     f"corr={result.correspondent}, sp={result.storage_path_id}")

    async def _post_process(
        self, result: ClassificationResult, config: ClassifierConfig,
        doc_content: str = "",
    ):
        """Post-process: normalize fields, filter tags, verify coherence."""
        logger.info(f"Post-process start: tags_from_model={result.tags}")
        result.custom_fields = self._normalize_custom_fields(result.custom_fields)

        # Remove obvious personal-number patterns (YYYY-NNNNN) from title
        if result.title:
            cleaned = _clean_title(result.title)
            if cleaned != result.title:
                logger.info(f"Title cleaned: '{result.title}' → '{cleaned}'")
                result.title = cleaned

        if result.storage_path_id:
            all_paths = await self.paperless.get_storage_paths(use_cache=True)
            for p in all_paths:
                if p.get("id") == result.storage_path_id:
                    result.storage_path_name = p.get("name", "")
                    break

        # --- Storage path behavior: revert to existing if behavior says so ---
        sp_behavior = getattr(config, "storage_path_behavior", "always") or "always"
        if sp_behavior != "always" and result.existing_storage_path_id:
            existing_name = (result.existing_storage_path_name or "").strip().lower()
            keep_existing = False
            if sp_behavior == "keep_if_set":
                keep_existing = True
            elif sp_behavior == "keep_except_list":
                override_names = [n.lower() for n in (getattr(config, "storage_path_override_names", None) or ["Zuweisen"])]
                keep_existing = existing_name not in override_names
            if keep_existing:
                ai_suggestion = result.storage_path_name or f"ID {result.storage_path_id}"
                ai_reason = result.storage_path_reason or ""
                logger.info(
                    f"Post-process: reverting storage path to existing '{result.existing_storage_path_name}' "
                    f"(id={result.existing_storage_path_id}) due to behavior='{sp_behavior}'"
                )
                result.storage_path_id = result.existing_storage_path_id
                result.storage_path_name = result.existing_storage_path_name
                result.storage_path_reason = (
                    f"Bestehender Pfad beibehalten (Regel: {sp_behavior}). "
                    f"KI-Vorschlag war: {ai_suggestion}"
                    + (f" – {ai_reason}" if ai_reason else "")
                )

        if result.correspondent:
            # Check against ignore list first
            corr_ignore = getattr(config, "correspondent_ignore", None) or []
            corr_ignore_lower = [n.lower().strip() for n in corr_ignore if n.strip()]
            corr_name_lower = result.correspondent.lower()
            ignored_by = next(
                (ign for ign in corr_ignore_lower
                 if ign in corr_name_lower or corr_name_lower in ign),
                None,
            )
            if ignored_by:
                logger.info(f"Correspondent ignored: '{result.correspondent}' (matched ignore entry '{ignored_by}')")
                result.correspondent = None
                result.correspondent_is_new = False

        if result.correspondent:
            # Strip legal forms if enabled (post-processing, independent of prompt option)
            if getattr(config, "correspondent_strip_legal", False):
                original = result.correspondent
                result.correspondent = _strip_legal_forms(result.correspondent)
                if result.correspondent != original:
                    logger.info(f"Correspondent legal-strip: '{original}' → '{result.correspondent}'")

            all_correspondents = await self.paperless.get_correspondents(use_cache=False)
            existing_corr_names = {c["name"].lower() for c in all_correspondents}
            result.correspondent_is_new = result.correspondent.lower() not in existing_corr_names

        if result.tags:
            all_tags = await self.paperless.get_tags(use_cache=True)
            existing_tag_names = {t["name"].lower() for t in all_tags}

            # Build ignore matchers: exact strings + wildcard patterns
            ignore_exact = set()
            ignore_patterns = []
            for t in (config.tags_ignore or []):
                if "*" in t:
                    regex_pat = re.escape(t).replace(r"\*", ".*")
                    ignore_patterns.append(re.compile(f"^{regex_pat}$", re.IGNORECASE))
                else:
                    ignore_exact.add(t.lower())

            def _is_ignored(tag_name: str) -> bool:
                if tag_name.lower() in ignore_exact:
                    return True
                return any(p.match(tag_name) for p in ignore_patterns)

            filtered_tags = []
            for tag in result.tags:
                tag_lower = tag.lower()
                # Exact match with document type (not substring!)
                if result.document_type and tag_lower == result.document_type.lower():
                    logger.info(f"Tag '{tag}' removed: exact match with document type")
                    continue
                if _is_ignored(tag):
                    logger.info(f"Tag '{tag}' removed: matches ignore pattern")
                    continue
                # Only remove if tag IS the correspondent name (exact), not a substring
                if result.correspondent and tag_lower == result.correspondent.lower():
                    logger.info(f"Tag '{tag}' removed: exact match with correspondent")
                    continue
                filtered_tags.append(tag)

            result.tags = filtered_tags
            result.tags_new = [t for t in result.tags if t.lower() not in existing_tag_names]
            logger.info(f"Post-process filtered tags: {result.tags} (new: {result.tags_new})")

        # --- Filter ignored dates ---
        if result.created_date and config.dates_ignore:
            normalized_result_date = self._normalize_date(result.created_date)
            for ignored in config.dates_ignore:
                if normalized_result_date and normalized_result_date == self._normalize_date(ignored):
                    logger.info(f"Date '{result.created_date}' matches ignore list ('{ignored}') -- cleared")
                    result.created_date = None
                    break

        self._verify_result_coherence(result, config, doc_content)

    async def classify_document(self, document_id: int) -> ClassificationResult:
        """Classify a single document and return proposals."""
        # Fresh Paperless data for every classification — new tags/correspondents
        # created by a previous apply must be visible immediately.
        from app.services.cache import get_cache
        await get_cache().clear("paperless:")

        config = await self.get_config()
        provider = await self._build_provider(config)

        document, doc_data = await self._build_document_context(document_id)
        if not document:
            return ClassificationResult(error=f"Document {document_id} not found")

        config_dict = self._build_config_dict(config)
        result = await provider.classify(document, config_dict)

        # Set existing metadata BEFORE _post_process so behavior logic can use it
        result.existing_tags = document.current_tags
        result.existing_correspondent = document.current_correspondent
        result.existing_document_type = document.current_document_type
        result.existing_storage_path_name = document.current_storage_path

        # Resolve existing storage path ID
        existing_sp_id = None
        if document.current_storage_path:
            all_paths = await self.paperless.get_storage_paths(use_cache=True)
            for p in all_paths:
                if p["name"] == document.current_storage_path:
                    existing_sp_id = p["id"]
                    break
        result.existing_storage_path_id = existing_sp_id

        # --- Fallback: if LLM returned nothing, keep the existing value ---
        if not result.title and document.current_title:
            result.title = document.current_title
            logger.info(f"Title fallback: kept existing '{document.current_title}'")
        if not result.correspondent and document.current_correspondent:
            result.correspondent = document.current_correspondent
            logger.info(f"Correspondent fallback: kept existing '{document.current_correspondent}'")
        if not result.document_type and document.current_document_type:
            result.document_type = document.current_document_type
            logger.info(f"DocType fallback: kept existing '{document.current_document_type}'")
        if result.storage_path_id is None and existing_sp_id:
            result.storage_path_id = existing_sp_id
            result.storage_path_name = document.current_storage_path
            result.storage_path_reason = "Vorhandener Speicherpfad beibehalten"
            logger.info(f"StoragePath fallback: kept existing id={existing_sp_id} '{document.current_storage_path}'")

        await self._post_process(result, config, document.content)

        # Remove old "pending" entries for this document before inserting the new one.
        # This prevents stale results from appearing in history / being loaded again.
        from sqlalchemy import delete as sa_delete
        await self.db.execute(
            sa_delete(ClassificationHistory)
            .where(ClassificationHistory.document_id == document_id)
            .where(ClassificationHistory.status == "pending")
        )

        history = ClassificationHistory(
            document_id=document_id,
            document_title=doc_data.get("title", ""),
            provider=config.active_provider,
            model=(
                config.openai_model if config.active_provider == "openai"
                else getattr(config, "mistral_model", "mistral-small-latest") if config.active_provider == "mistral"
                else config.ollama_model
            ),
            result_json=asdict(result),
            tokens_input=result.tokens_input,
            tokens_output=result.tokens_output,
            cost_usd=result.cost_usd,
            duration_seconds=result.duration_seconds,
            tool_calls_count=result.tool_calls_count,
            status="error" if result.error else "pending",
            error_message=result.error or "",
        )
        self.db.add(history)
        await self.db.commit()

        return result

    async def _build_provider_by_name(
        self, provider_name: str, config: ClassifierConfig,
        model_override: Optional[str] = None,
    ) -> BaseClassifierProvider:
        """Build a specific provider with optional model override."""
        storage_profiles = await self.get_storage_profiles()
        field_mappings = await self.get_custom_field_mappings()
        tool_executor = self._build_tool_executor(config, storage_profiles, field_mappings)

        if provider_name == "openai":
            api_key = await self._get_openai_key()
            if not api_key:
                raise ValueError("OpenAI API key not configured")
            return OpenAIToolCallingProvider(
                api_key=api_key,
                model=model_override or config.openai_model,
                tool_executor=tool_executor,
            )
        elif provider_name == "mistral":
            api_key = getattr(config, "mistral_api_key", "") or ""
            if not api_key:
                raise ValueError("Mistral API key not configured")
            return OpenAIToolCallingProvider(
                api_key=api_key,
                model=model_override or getattr(config, "mistral_model", "mistral-small-latest"),
                tool_executor=tool_executor,
                base_url="https://api.mistral.ai/v1",
                provider_label="Mistral",
            )
        elif provider_name == "ollama":
            return OllamaMultiCallProvider(
                host=config.ollama_host,
                model=model_override or config.ollama_model,
                tool_executor=tool_executor,
            )
        else:
            raise ValueError(f"Unknown provider: {provider_name}")

    async def benchmark_document(
        self, document_id: int,
        slots: List[tuple],
    ) -> Dict[str, Any]:
        """Run classification with N provider/model combos.

        Ollama models run sequentially (shared GPU), cloud providers run in
        parallel alongside.
        """
        import asyncio

        config = await self.get_config()
        document, doc_data = await self._build_document_context(document_id)
        if not document:
            return {"error": f"Document {document_id} not found"}

        config_dict = self._build_config_dict(config)

        # Resolve existing storage path ID once (shared across benchmark slots)
        bench_existing_sp_id = None
        if document.current_storage_path:
            all_paths = await self.paperless.get_storage_paths(use_cache=True)
            for p in all_paths:
                if p["name"] == document.current_storage_path:
                    bench_existing_sp_id = p["id"]
                    break

        async def run_single(name: str, model: Optional[str]) -> Dict[str, Any]:
            actual_model = model or (config.openai_model if name == "openai" else config.ollama_model)
            try:
                provider = await self._build_provider_by_name(name, config, model)
                result = await provider.classify(document, config_dict)
                # Set existing metadata before _post_process so behavior logic works
                result.existing_tags = document.current_tags
                result.existing_correspondent = document.current_correspondent
                result.existing_document_type = document.current_document_type
                result.existing_storage_path_name = document.current_storage_path
                result.existing_storage_path_id = bench_existing_sp_id
                await self._post_process(result, config, document.content)
                return {
                    "provider": name,
                    "model": actual_model,
                    "result": asdict(result),
                }
            except Exception as e:
                logger.error(f"Benchmark {name}/{actual_model} failed: {e}", exc_info=True)
                return {
                    "provider": name,
                    "model": actual_model,
                    "result": asdict(ClassificationResult(error=str(e))),
                }

        cloud_slots = [(n, m) for n, m in slots if n != "ollama"]
        local_slots = [(n, m) for n, m in slots if n == "ollama"]

        async def run_local_sequential() -> List[Dict[str, Any]]:
            results = []
            for name, model in local_slots:
                r = await run_single(name, model)
                results.append(r)
            return results

        cloud_tasks = [asyncio.create_task(run_single(n, m)) for n, m in cloud_slots]
        local_task = asyncio.create_task(run_local_sequential()) if local_slots else None

        cloud_results = await asyncio.gather(*cloud_tasks) if cloud_tasks else []
        local_results = await local_task if local_task else []

        all_results = []
        cloud_iter = iter(cloud_results)
        local_iter = iter(local_results)
        for name, _ in slots:
            if name == "ollama":
                all_results.append(next(local_iter))
            else:
                all_results.append(next(cloud_iter))

        return {
            "document_id": document_id,
            "document_title": doc_data.get("title", ""),
            "results": all_results,
        }

    async def apply_classification(
        self, document_id: int, classification: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Apply a (potentially edited) classification to a document in Paperless."""
        config = await self.get_config()
        update_data = {}

        if classification.get("title"):
            update_data["title"] = classification["title"]

        created = classification.get("created_date")
        if created and created != "null" and re.match(r"\d{4}-\d{2}-\d{2}", str(created)):
            update_data["created"] = created

        # Resolve tags to IDs
        if classification.get("tags"):
            all_tags = await self.paperless.get_tags(use_cache=True)
            tag_name_to_id = {t["name"].lower(): t["id"] for t in all_tags}
            tag_id_to_name = {t["id"]: t["name"] for t in all_tags}
            tag_ids = []
            for tag_name in classification["tags"]:
                tid = tag_name_to_id.get(tag_name.lower())
                if tid:
                    tag_ids.append(tid)
                else:
                    new_tag = await self.paperless.get_or_create_tag(tag_name)
                    if new_tag:
                        tag_ids.append(new_tag["id"])

            doc = await self.paperless.get_document(document_id)
            existing_tag_ids = doc.get("tags", []) if doc else []

            if config.tags_keep_existing:
                for etid in existing_tag_ids:
                    if etid not in tag_ids:
                        tag_ids.append(etid)
            else:
                # Replacing mode: keep protected tags from existing document
                protected_patterns = self._build_protected_matchers(config)
                if protected_patterns:
                    for etid in existing_tag_ids:
                        tag_name = tag_id_to_name.get(etid, "")
                        if etid not in tag_ids and self._is_tag_protected(tag_name, protected_patterns):
                            tag_ids.append(etid)
                            logger.info(f"Apply: keeping protected tag '{tag_name}' (id={etid})")

            if tag_ids:
                update_data["tags"] = tag_ids

        # Resolve correspondent
        if classification.get("correspondent"):
            corr = await self.paperless.get_or_create_correspondent(
                classification["correspondent"]
            )
            if corr:
                update_data["correspondent"] = corr["id"]

        # Resolve document type
        if classification.get("document_type"):
            all_types = await self.paperless.get_document_types(use_cache=True)
            for dt in all_types:
                if dt["name"].lower() == classification["document_type"].lower():
                    update_data["document_type"] = dt["id"]
                    break

        # Storage path -- respect configured behavior
        if classification.get("storage_path_id"):
            sp_behavior = getattr(config, "storage_path_behavior", "always") or "always"
            sp_override_names = getattr(config, "storage_path_override_names", ["Zuweisen"]) or ["Zuweisen"]
            existing_sp_id = classification.get("existing_storage_path_id")
            existing_sp_name = (classification.get("existing_storage_path_name") or "").strip()

            # Fallback: fetch live from Paperless if not provided (extra safety)
            if not existing_sp_id and sp_behavior != "always":
                live_doc = await self.paperless.get_document(document_id)
                if live_doc and live_doc.get("storage_path"):
                    existing_sp_id = live_doc["storage_path"]
                    all_paths = await self.paperless.get_storage_paths(use_cache=True)
                    sp_map = {p["id"]: p["name"] for p in all_paths}
                    existing_sp_name = sp_map.get(existing_sp_id, "")
                    logger.info(f"Storage path fallback from Paperless: '{existing_sp_name}' (id={existing_sp_id})")

            apply_sp = True
            if sp_behavior == "keep_if_set":
                # Never change if document already has a path
                apply_sp = not existing_sp_id
            elif sp_behavior == "keep_except_list":
                # Keep existing UNLESS the current path name is in the override list
                if existing_sp_id:
                    override_names_lower = [n.lower() for n in sp_override_names]
                    apply_sp = existing_sp_name.lower() in override_names_lower
                # If no path set yet, always assign
            # "always" => apply_sp stays True

            if apply_sp:
                update_data["storage_path"] = classification["storage_path_id"]
            else:
                logger.info(
                    f"Storage path skipped (behavior={sp_behavior}): "
                    f"existing='{existing_sp_name}' (id={existing_sp_id})"
                )

        # Custom fields
        if classification.get("custom_fields"):
            field_mappings = await self.get_custom_field_mappings()
            field_name_to_id = {m.paperless_field_name: m.paperless_field_id for m in field_mappings}
            custom_field_updates = []
            for field_name, value in classification["custom_fields"].items():
                fid = field_name_to_id.get(field_name)
                if fid and value is not None:
                    custom_field_updates.append({"field": fid, "value": value})
            if custom_field_updates:
                update_data["custom_fields"] = custom_field_updates

        if not update_data:
            return {"applied": False, "reason": "No changes to apply"}

        logger.info(f"Applying to doc {document_id}: {update_data}")
        result = await self.paperless.update_document(document_id, update_data)

        # Mark latest pending/review history entry for this document as applied
        try:
            from sqlalchemy import select, desc
            from app.models.classifier import ClassificationHistory
            hist_q = await self.db.execute(
                select(ClassificationHistory)
                .where(ClassificationHistory.document_id == document_id)
                .where(ClassificationHistory.status.in_(["pending", "review"]))
                .order_by(desc(ClassificationHistory.id))
                .limit(1)
            )
            hist = hist_q.scalars().first()
            if hist:
                hist.status = "applied"
                await self.db.commit()
                logger.info(f"History entry {hist.id} marked as applied for doc {document_id} (was: {hist.status})")
        except Exception as e:
            logger.warning(f"Could not update history status: {e}")

        # Always refresh cache after apply -- new tags/correspondents must be
        # visible immediately for the next classification call.
        from app.services.cache import get_cache
        cache = get_cache()
        await cache.clear("paperless:")
        logger.info("Cache cleared after apply -- next classification gets fresh Paperless data")

        return {"applied": True, "updated_fields": list(update_data.keys()), "result": result}

    @staticmethod
    def _needs_review(result: ClassificationResult) -> str:
        """Check if a classification result needs manual review. Returns reason or empty string.

        Only triggers for real problems — not for normal new correspondents/tags,
        since those are clearly visible in the history view.
        """
        reasons = []

        if result.error:
            reasons.append("Fehler bei Klassifizierung")
        if not result.title:
            reasons.append("Kein Titel erkannt")
        if not result.correspondent and not result.document_type:
            reasons.append("Weder Korrespondent noch Dokumenttyp erkannt")
        if not result.tags:
            reasons.append("Keine Tags erkannt")

        return "; ".join(reasons)

    async def classify_document_auto(self, document_id: int, mode: str = "review") -> Dict[str, Any]:
        """Classify a document in auto-mode.

        New tags suggested by the AI are NOT created automatically.
        Instead they are saved as 'tag_ideas' on the history entry for
        manual review. The document gets classified with existing tags only.
        """
        result = await self.classify_document(document_id)
        review_reason = self._needs_review(result)

        if result.error:
            return {"document_id": document_id, "action": "error", "reason": result.error}

        # Extract new tag ideas before applying
        tag_ideas = list(result.tags_new) if result.tags_new else []
        has_tag_ideas = len(tag_ideas) > 0

        # Build a version of the result that only uses existing tags
        apply_data = asdict(result)
        if has_tag_ideas:
            existing_tags = [t for t in (result.tags or []) if t not in tag_ideas]
            apply_data["tags"] = existing_tags
            apply_data["tags_new"] = []
            logger.info(
                f"Auto-classify doc {document_id}: {len(tag_ideas)} tag idea(s) saved: {tag_ideas}"
            )

        if mode == "auto_apply" and not review_reason:
            await self.apply_classification(document_id, apply_data)
            # Save tag ideas on the history entry
            if has_tag_ideas:
                await self._save_tag_ideas(document_id, tag_ideas)
            return {
                "document_id": document_id,
                "action": "applied",
                "tag_ideas": tag_ideas,
            }

        # Mark as "review" in history if needed
        if review_reason:
            try:
                hist_q = await self.db.execute(
                    select(ClassificationHistory)
                    .where(ClassificationHistory.document_id == document_id)
                    .where(ClassificationHistory.status == "pending")
                    .order_by(ClassificationHistory.id.desc())
                    .limit(1)
                )
                hist = hist_q.scalars().first()
                if hist:
                    hist.status = "review"
                    hist.error_message = review_reason
                    if has_tag_ideas:
                        hist.tag_ideas = tag_ideas
                    await self.db.commit()
            except Exception as e:
                logger.warning(f"Could not mark as review: {e}")
        else:
            # No review needed — auto-apply with existing tags only
            await self.apply_classification(document_id, apply_data)
            if has_tag_ideas:
                await self._save_tag_ideas(document_id, tag_ideas)
            return {
                "document_id": document_id,
                "action": "applied",
                "tag_ideas": tag_ideas,
            }

        return {
            "document_id": document_id,
            "action": "review" if review_reason else "pending",
            "reason": review_reason,
            "tag_ideas": tag_ideas,
        }

    async def _save_tag_ideas(self, document_id: int, tag_ideas: List[str]):
        """Save tag ideas on the latest history entry for a document."""
        try:
            hist_q = await self.db.execute(
                select(ClassificationHistory)
                .where(ClassificationHistory.document_id == document_id)
                .order_by(ClassificationHistory.id.desc())
                .limit(1)
            )
            hist = hist_q.scalars().first()
            if hist:
                hist.tag_ideas = tag_ideas
                await self.db.commit()
        except Exception as e:
            logger.warning(f"Could not save tag ideas for doc {document_id}: {e}")
