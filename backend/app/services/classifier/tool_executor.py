"""Executes tool calls locally against the Paperless API.

When OpenAI returns a tool call like search_tags("Rechnung"),
this module resolves it by searching our cached Paperless data.
No external access to our system required.
"""

import json
import logging
import re
from typing import Dict, Any, List, Set, Optional

from app.services.paperless_client import PaperlessClient
from app.models.classifier import StoragePathProfile, CustomFieldMapping

logger = logging.getLogger(__name__)


class ToolExecutor:
    """Resolves OpenAI tool calls against local Paperless data."""

    def __init__(
        self,
        paperless: PaperlessClient,
        storage_profiles: List[StoragePathProfile],
        custom_field_mappings: List[CustomFieldMapping],
        excluded_tag_ids: Optional[List[int]] = None,
        excluded_correspondent_ids: Optional[List[int]] = None,
        excluded_document_type_ids: Optional[List[int]] = None,
        tags_ignore: Optional[List[str]] = None,
    ):
        self.paperless = paperless
        self.storage_profiles = storage_profiles
        self.custom_field_mappings = custom_field_mappings
        self._excluded_tag_ids: Set[int] = set(excluded_tag_ids or [])
        self._excluded_corr_ids: Set[int] = set(excluded_correspondent_ids or [])
        self._excluded_dtype_ids: Set[int] = set(excluded_document_type_ids or [])

        self._tags_ignore_exact: Set[str] = set()
        self._tags_ignore_patterns: list = []
        for pat in (tags_ignore or []):
            if "*" in pat:
                regex_pat = re.escape(pat).replace(r"\*", ".*")
                self._tags_ignore_patterns.append(re.compile(f"^{regex_pat}$", re.IGNORECASE))
            else:
                self._tags_ignore_exact.add(pat.lower())

    def _is_tag_ignored(self, tag_name: str) -> bool:
        if tag_name.lower() in self._tags_ignore_exact:
            return True
        return any(p.match(tag_name) for p in self._tags_ignore_patterns)

    async def execute(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Execute a tool call and return the result as JSON string."""
        handlers = {
            "search_tags": self._search_tags,
            "search_correspondents": self._search_correspondents,
            "get_document_types": self._get_document_types,
            "get_storage_paths": self._get_storage_paths,
            "get_custom_field_definitions": self._get_custom_field_definitions,
        }

        handler = handlers.get(tool_name)
        if not handler:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

        try:
            result = await handler(arguments)
            return json.dumps(result, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Tool execution failed for {tool_name}: {e}")
            return json.dumps({"error": str(e)})

    async def _search_tags(self, args: Dict) -> List[Dict]:
        query = args.get("query", "").lower()
        all_tags = await self.paperless.get_tags(use_cache=True)

        results = []
        for tag in all_tags:
            tag_id = tag.get("id")
            name = tag.get("name", "")
            if tag_id in self._excluded_tag_ids:
                continue
            if self._is_tag_ignored(name):
                continue
            if not query or query in name.lower():
                results.append({
                    "id": tag_id,
                    "name": name,
                    "document_count": tag.get("document_count", 0),
                })

        ignore_total = len(self._tags_ignore_exact) + len(self._tags_ignore_patterns)
        logger.info(f"search_tags('{query}'): {len(all_tags)} total -> {len(results)} after exclusions "
                     f"(excluded_ids={len(self._excluded_tag_ids)}, "
                     f"ignore_exact={len(self._tags_ignore_exact)}, "
                     f"ignore_patterns={len(self._tags_ignore_patterns)})")
        return results if not query else results[:20]

    async def _search_correspondents(self, args: Dict) -> List[Dict]:
        query = args.get("query", "").lower()
        all_correspondents = await self.paperless.get_correspondents(use_cache=True)

        results = []
        for c in all_correspondents:
            c_id = c.get("id")
            name = c.get("name", "")
            if c_id in self._excluded_corr_ids:
                continue
            if not query or query in name.lower():
                results.append({
                    "id": c_id,
                    "name": name,
                    "document_count": c.get("document_count", 0),
                })

        return results if not query else results[:20]

    async def _get_document_types(self, _args: Dict) -> List[Dict]:
        all_types = await self.paperless.get_document_types(use_cache=True)
        return [
            {
                "id": dt.get("id"),
                "name": dt.get("name", ""),
                "document_count": dt.get("document_count", 0),
            }
            for dt in all_types
            if dt.get("id") not in self._excluded_dtype_ids
        ]

    async def _get_storage_paths(self, _args: Dict) -> List[Dict]:
        return [
            {
                "id": sp.paperless_path_id,
                "name": sp.paperless_path_name,
                "path": sp.paperless_path_path,
                "person_name": sp.person_name,
                "type": sp.path_type,
                "context_prompt": sp.context_prompt,
            }
            for sp in self.storage_profiles
            if sp.enabled
        ]

    async def _get_custom_field_definitions(self, _args: Dict) -> List[Dict]:
        result = []
        for cfm in self.custom_field_mappings:
            if not cfm.enabled:
                continue
            entry: Dict[str, Any] = {
                "field_id": cfm.paperless_field_id,
                "field_name": cfm.paperless_field_name,
                "field_type": cfm.paperless_field_type,
                "extraction_prompt": cfm.extraction_prompt,
                "example_values": cfm.example_values,
            }
            if cfm.ignore_values:
                entry["ignore_values"] = cfm.ignore_values
                entry["extraction_prompt"] += (
                    f" (Nicht verwechseln mit eigenen Werten: {cfm.ignore_values})"
                )
            result.append(entry)
        return result
