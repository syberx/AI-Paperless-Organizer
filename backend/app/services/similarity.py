"""Similarity detection service using LLM."""

import json
import re
import fnmatch
from typing import Dict, List
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import CustomPrompt, IgnoredTag
from app.services.paperless_client import PaperlessClient, get_paperless_client
from app.services.llm_provider import LLMProviderService, get_llm_service
from app.prompts.default_prompts import DEFAULT_PROMPTS


class SimilarityService:
    """Service for finding similar entities using LLM analysis."""
    
    def __init__(
        self, 
        paperless_client: PaperlessClient,
        llm_service: LLMProviderService,
        db: AsyncSession
    ):
        self.paperless = paperless_client
        self.llm = llm_service
        self.db = db
    
    async def _get_prompt(self, entity_type: str) -> str:
        """Get the prompt template for an entity type."""
        result = await self.db.execute(
            select(CustomPrompt).where(
                CustomPrompt.entity_type == entity_type,
                CustomPrompt.is_active == True
            )
        )
        prompt = result.scalar_one_or_none()
        
        if prompt:
            return prompt.prompt_template
        
        return DEFAULT_PROMPTS.get(entity_type, "")
    
    async def _get_ignored_patterns(self) -> List[Dict]:
        """Get all ignored tag patterns."""
        result = await self.db.execute(select(IgnoredTag))
        ignored = result.scalars().all()
        return [{"pattern": i.pattern, "is_regex": i.is_regex, "reason": i.reason} for i in ignored]
    
    def _is_tag_ignored(self, tag_name: str, ignored_patterns: List[Dict]) -> bool:
        """Check if a tag matches any ignored pattern."""
        for pattern_info in ignored_patterns:
            pattern = pattern_info["pattern"]
            is_regex = pattern_info.get("is_regex", False)
            
            if is_regex:
                try:
                    if re.match(pattern, tag_name, re.IGNORECASE):
                        return True
                except:
                    pass
            else:
                # Support simple wildcards (* for any characters)
                if "*" in pattern:
                    # Convert to regex
                    regex_pattern = fnmatch.translate(pattern)
                    if re.match(regex_pattern, tag_name, re.IGNORECASE):
                        return True
                elif pattern.lower() == tag_name.lower():
                    return True
        
        return False
    
    def _filter_ignored_tags(self, tags: List[Dict], ignored_patterns: List[Dict]) -> tuple:
        """Filter out ignored tags and return (filtered, ignored_count)."""
        filtered = []
        ignored_count = 0
        
        for tag in tags:
            if self._is_tag_ignored(tag.get("name", ""), ignored_patterns):
                ignored_count += 1
            else:
                filtered.append(tag)
        
        return filtered, ignored_count
    
    async def _analyze_batch(self, items: List[Dict], prompt_template: str) -> Dict:
        """Analyze a single batch of items."""
        return await self.llm.analyze_for_similarity(prompt_template, items)
    
    async def _analyze_with_batching(self, all_items: List[Dict], prompt_template: str, batch_size: int = 200) -> Dict:
        """Analyze items with automatic batching for large lists - ONLY if necessary."""
        
        # Get token limit from LLM provider
        token_limit = self.llm.get_token_limit()
        
        # Estimate tokens for all items
        items_str = json.dumps([item["name"] for item in all_items], ensure_ascii=False)
        full_prompt = prompt_template.replace("{items}", items_str)
        estimated_tokens = self.llm.estimate_tokens(full_prompt)
        
        # Leave 20% buffer for output
        safe_limit = int(token_limit * 0.8)
        
        # If it fits in one request, don't batch!
        if estimated_tokens <= safe_limit:
            return await self._analyze_batch(all_items, prompt_template)
        
        # Calculate how many items fit per batch
        tokens_per_item = max(1, estimated_tokens // len(all_items))
        optimal_batch_size = max(50, safe_limit // tokens_per_item)
        batch_size = min(batch_size, optimal_batch_size)
        
        # WICHTIG: Sortiere Items alphabetisch BEVOR wir batchen
        # So landen ähnliche Namen (1&1, 1&1 Internet, 1und1) im gleichen Batch
        sorted_items = sorted(all_items, key=lambda x: x.get("name", "").lower())
        
        # Split into batches
        batches = [sorted_items[i:i + batch_size] for i in range(0, len(sorted_items), batch_size)]
        
        all_groups = []
        total_stats = {
            "items_count": len(all_items),
            "estimated_input_tokens": estimated_tokens,
            "token_limit": token_limit,
            "estimated_output_tokens": 0,
            "estimated_total_tokens": 0,
            "batches_processed": 0,
            "batches_total": len(batches),
            "batch_size": batch_size,
            "cross_batch_phase": False,
            "warning": f"Tokens (~{estimated_tokens}) > Limit ({safe_limit}). In {len(batches)} Batches aufgeteilt."
        }
        
        errors = []
        grouped_item_ids = set()  # Track which items got grouped
        
        # Phase 1: Analyze each batch
        for i, batch in enumerate(batches):
            try:
                result = await self._analyze_batch(batch, prompt_template)
                
                # Collect groups
                groups = result.get("groups", [])
                all_groups.extend(groups)
                
                # Track grouped items
                for group in groups:
                    for member in group.get("members", []):
                        grouped_item_ids.add(member.get("id"))
                
                # Accumulate stats
                stats = result.get("stats", {})
                total_stats["estimated_input_tokens"] += stats.get("estimated_input_tokens", 0)
                total_stats["estimated_output_tokens"] += stats.get("estimated_output_tokens", 0)
                total_stats["batches_processed"] += 1
                
                if result.get("error"):
                    errors.append(f"Batch {i+1}: {result['error']}")
                    
            except Exception as e:
                errors.append(f"Batch {i+1}: {str(e)}")
        
        # Phase 2: Cross-batch comparison
        # Find items that weren't grouped and compare all group names
        ungrouped_items = [item for item in all_items if item.get("id") not in grouped_item_ids]
        
        if len(all_groups) > 1 or (len(ungrouped_items) > 0 and len(all_groups) > 0):
            try:
                merged_groups = await self._cross_batch_merge(all_groups, all_items, ungrouped_items)
                if merged_groups:
                    total_stats["cross_batch_phase"] = True
                    total_stats["groups_before_merge"] = len(all_groups)
                    total_stats["groups_after_merge"] = len(merged_groups)
                    total_stats["ungrouped_items_checked"] = len(ungrouped_items)
                    all_groups = merged_groups
            except Exception as e:
                errors.append(f"Cross-batch merge: {str(e)}")
        
        total_stats["estimated_total_tokens"] = (
            total_stats["estimated_input_tokens"] + 
            total_stats["estimated_output_tokens"]
        )
        
        result = {
            "groups": all_groups,
            "stats": total_stats
        }
        
        if errors:
            result["error"] = "; ".join(errors)
        
        return result
    
    async def _cross_batch_merge(self, groups: List[Dict], all_items: List[Dict], ungrouped_items: List[Dict] = None) -> List[Dict]:
        """Merge groups from different batches that are similar.
        
        Also checks if ungrouped items should belong to existing groups.
        """
        if len(groups) == 0:
            return groups
        
        # Build a lookup of all items by ID and name
        items_by_id = {item["id"]: item for item in all_items}
        items_by_name = {item["name"].lower(): item for item in all_items}
        
        # Collect all suggested names and their members for context
        group_info = []
        for g in groups:
            members_preview = [m.get("name", "") for m in g.get("members", [])[:5]]
            group_info.append({
                "name": g.get("suggested_name", ""),
                "members": members_preview
            })
        
        # Also include ungrouped items that might belong to groups
        ungrouped_names = []
        if ungrouped_items:
            ungrouped_names = [item.get("name", "") for item in ungrouped_items[:100]]  # Limit to 100
        
        # Ask LLM to find similar group names AND check ungrouped items
        cross_batch_prompt = f"""Du hast mehrere Gruppen aus verschiedenen Batches analysiert.
        
1. Prüfe ob einige dieser GRUPPEN zusammengehören und zur gleichen Entität gehören.
2. Prüfe ob UNGRUPPIERTE EINTRÄGE zu einer existierenden Gruppe gehören sollten.

GRUPPEN (mit Beispiel-Mitgliedern):
{json.dumps(group_info, ensure_ascii=False, indent=2)}

UNGRUPPIERTE EINTRÄGE (gehören evtl. zu einer Gruppe):
{json.dumps(ungrouped_names[:50], ensure_ascii=False, indent=2) if ungrouped_names else "[]"}

Antworte NUR mit validem JSON:
{{
  "group_merges": [
    {{
      "target_name": "Bester Name für die zusammengeführte Gruppe",
      "source_names": ["gruppenname1", "gruppenname2"],
      "reasoning": "Kurze Begründung"
    }}
  ],
  "add_to_groups": [
    {{
      "group_name": "Name der existierenden Gruppe",
      "items_to_add": ["ungruppierter_name1", "ungruppierter_name2"],
      "reasoning": "Kurze Begründung"
    }}
  ]
}}

Beispiel: Wenn "1&1" in einer Gruppe ist und "1und1 Internet" ungruppiert, sollte "1und1 Internet" zu der "1&1" Gruppe hinzugefügt werden.

Wenn nichts zusammengehört: {{"group_merges": [], "add_to_groups": []}}"""

        try:
            response = await self.llm.complete(cross_batch_prompt)
            
            # Parse response
            json_match = re.search(r'\{[\s\S]*\}', response)
            if not json_match:
                return groups
            
            merge_result = json.loads(json_match.group())
            group_merges = merge_result.get("group_merges", [])
            add_to_groups = merge_result.get("add_to_groups", [])
            
            # Start with original groups
            merged_groups = []
            merged_names = set()
            processed_groups = {g.get("suggested_name", "").lower(): g for g in groups}
            
            # Phase A: Merge groups together
            for merge in group_merges:
                target_name = merge.get("target_name", "")
                source_names = [n.lower() for n in merge.get("source_names", [])]
                reasoning = merge.get("reasoning", "Cross-batch merge")
                
                # Find all groups that match source_names
                combined_members = []
                for source_name in source_names:
                    if source_name in processed_groups:
                        combined_members.extend(processed_groups[source_name].get("members", []))
                        merged_names.add(source_name)
                
                if combined_members:
                    # Deduplicate members by ID
                    seen_ids = set()
                    unique_members = []
                    for member in combined_members:
                        if member.get("id") not in seen_ids:
                            seen_ids.add(member.get("id"))
                            unique_members.append(member)
                    
                    merged_groups.append({
                        "suggested_name": target_name,
                        "confidence": 0.85,
                        "members": unique_members,
                        "reasoning": f"{reasoning} (Cross-batch merge)"
                    })
            
            # Add groups that weren't merged
            for group in groups:
                if group.get("suggested_name", "").lower() not in merged_names:
                    merged_groups.append(group)
            
            # Phase B: Add ungrouped items to existing groups
            if add_to_groups and ungrouped_items:
                ungrouped_by_name = {item["name"].lower(): item for item in ungrouped_items}
                
                for addition in add_to_groups:
                    group_name = addition.get("group_name", "").lower()
                    items_to_add = [n.lower() for n in addition.get("items_to_add", [])]
                    
                    # Find the target group
                    for group in merged_groups:
                        if group.get("suggested_name", "").lower() == group_name:
                            existing_ids = {m.get("id") for m in group.get("members", [])}
                            
                            for item_name in items_to_add:
                                if item_name in ungrouped_by_name:
                                    item = ungrouped_by_name[item_name]
                                    if item.get("id") not in existing_ids:
                                        group["members"].append(item)
                                        existing_ids.add(item.get("id"))
                            break
            
            return merged_groups
            
        except Exception as e:
            # If cross-batch merge fails, return original groups
            return groups

    async def find_similar_correspondents(self, batch_size: int = 200) -> Dict:
        """Find similar correspondents using LLM analysis."""
        correspondents = await self.paperless.get_correspondents_with_counts()
        
        if not correspondents:
            return {"groups": [], "stats": {"items_count": 0, "estimated_input_tokens": 0, "estimated_output_tokens": 0, "estimated_total_tokens": 0}}
        
        items = [
            {"id": c["id"], "name": c["name"], "document_count": c.get("document_count", 0)}
            for c in correspondents
        ]
        
        prompt_template = await self._get_prompt("correspondents")
        return await self._analyze_with_batching(items, prompt_template, batch_size)
    
    async def find_similar_tags(self, batch_size: int = 200) -> Dict:
        """Find similar tags using LLM analysis."""
        tags = await self.paperless.get_tags_with_counts()
        
        if not tags:
            return {"groups": [], "stats": {"items_count": 0, "estimated_input_tokens": 0, "estimated_output_tokens": 0, "estimated_total_tokens": 0}}
        
        items = [
            {"id": t["id"], "name": t["name"], "document_count": t.get("document_count", 0)}
            for t in tags
        ]
        
        prompt_template = await self._get_prompt("tags")
        return await self._analyze_with_batching(items, prompt_template, batch_size)
    
    async def find_similar_document_types(self, batch_size: int = 200) -> Dict:
        """Find similar document types using LLM analysis."""
        doc_types = await self.paperless.get_document_types_with_counts()
        
        if not doc_types:
            return {"groups": [], "stats": {"items_count": 0, "estimated_input_tokens": 0, "estimated_output_tokens": 0, "estimated_total_tokens": 0}}
        
        items = [
            {"id": dt["id"], "name": dt["name"], "document_count": dt.get("document_count", 0)}
            for dt in doc_types
        ]
        
        prompt_template = await self._get_prompt("document_types")
        return await self._analyze_with_batching(items, prompt_template, batch_size)
    
    async def find_nonsense_tags(self, batch_size: int = 300) -> Dict:
        """Find nonsense/useless tags using LLM analysis."""
        tags = await self.paperless.get_tags_with_counts()
        
        if not tags:
            return {"nonsense_tags": [], "stats": {"items_count": 0}}
        
        # Get and apply ignore list
        ignored_patterns = await self._get_ignored_patterns()
        filtered_tags, ignored_count = self._filter_ignored_tags(tags, ignored_patterns)
        
        if not filtered_tags:
            return {
                "nonsense_tags": [], 
                "stats": {"items_count": len(tags), "ignored_count": ignored_count, "analyzed_count": 0}
            }
        
        # Format items with document count for context
        items_text = "\n".join([
            f"- {t['name']}: {t.get('document_count', 0)} Dokumente"
            for t in filtered_tags
        ])
        
        # Add ignore list info to prompt
        ignore_info = ""
        if ignored_patterns:
            ignore_info = "\n\nFolgende Tags sind GESCHÜTZT und dürfen NICHT als unsinnig markiert werden:\n"
            ignore_info += "\n".join([f"- {p['pattern']} ({p['reason']})" for p in ignored_patterns])
        
        prompt_template = await self._get_prompt("tags_nonsense")
        prompt = prompt_template.replace("{items}", items_text) + ignore_info
        
        try:
            response = await self.llm.complete(prompt)
            
            # Parse JSON from response
            json_match = re.search(r'\{[\s\S]*\}', response)
            if not json_match:
                return {"nonsense_tags": [], "error": "Invalid JSON response"}
            
            result = json.loads(json_match.group())
            nonsense_tags = result.get("nonsense_tags", [])
            
            # Enrich with tag IDs and double-check ignore list
            tags_by_name = {t["name"].lower(): t for t in tags}
            enriched = []
            for nt in nonsense_tags:
                tag_name = nt.get("name", "")
                # Skip if in ignore list (double check)
                if self._is_tag_ignored(tag_name, ignored_patterns):
                    continue
                    
                tag_data = tags_by_name.get(tag_name.lower())
                if tag_data:
                    enriched.append({
                        "id": tag_data["id"],
                        "name": tag_data["name"],
                        "document_count": tag_data.get("document_count", 0),
                        "confidence": nt.get("confidence", 0.5),
                        "reason": nt.get("reason", "")
                    })
            
            return {
                "nonsense_tags": enriched,
                "stats": {
                    "items_count": len(tags), 
                    "ignored_count": ignored_count,
                    "analyzed_count": len(filtered_tags),
                    "found_count": len(enriched)
                }
            }
            
        except Exception as e:
            return {"nonsense_tags": [], "error": str(e)}
    
    async def find_tags_that_are_correspondents(self, batch_size: int = 300) -> Dict:
        """Find tags that should be correspondents using LLM analysis."""
        tags = await self.paperless.get_tags_with_counts()
        correspondents = await self.paperless.get_correspondents()
        
        if not tags:
            return {"correspondent_tags": [], "stats": {"items_count": 0}}
        
        # Format items
        tags_text = "\n".join([f"- {t['name']}" for t in tags])
        corr_text = "\n".join([f"- {c['name']}" for c in correspondents])
        
        prompt_template = await self._get_prompt("tags_are_correspondents")
        prompt = prompt_template.replace("{items}", tags_text).replace("{correspondents}", corr_text)
        
        try:
            response = await self.llm.complete(prompt)
            
            import re
            json_match = re.search(r'\{[\s\S]*\}', response)
            if not json_match:
                return {"correspondent_tags": [], "error": "Invalid JSON response"}
            
            result = json.loads(json_match.group())
            correspondent_tags = result.get("correspondent_tags", [])
            
            # Enrich with tag IDs and correspondent IDs
            tags_by_name = {t["name"].lower(): t for t in tags}
            corr_by_name = {c["name"].lower(): c for c in correspondents}
            
            enriched = []
            for ct in correspondent_tags:
                tag_name = ct.get("tag_name", "")
                tag_data = tags_by_name.get(tag_name.lower())
                suggested = ct.get("suggested_correspondent", "")
                corr_data = corr_by_name.get(suggested.lower())
                
                if tag_data:
                    enriched.append({
                        "tag_id": tag_data["id"],
                        "tag_name": tag_data["name"],
                        "document_count": tag_data.get("document_count", 0),
                        "suggested_correspondent": suggested,
                        "correspondent_id": corr_data["id"] if corr_data else None,
                        "correspondent_exists": corr_data is not None,
                        "confidence": ct.get("confidence", 0.5),
                        "reason": ct.get("reason", "")
                    })
            
            return {
                "correspondent_tags": enriched,
                "stats": {"tags_count": len(tags), "correspondents_count": len(correspondents), "found_count": len(enriched)}
            }
            
        except Exception as e:
            return {"correspondent_tags": [], "error": str(e)}
    
    async def find_tags_that_are_document_types(self, batch_size: int = 300) -> Dict:
        """Find tags that should be document types using LLM analysis."""
        tags = await self.paperless.get_tags_with_counts()
        doc_types = await self.paperless.get_document_types()
        
        if not tags:
            return {"doctype_tags": [], "stats": {"items_count": 0}}
        
        # Format items
        tags_text = "\n".join([f"- {t['name']}" for t in tags])
        dt_text = "\n".join([f"- {dt['name']}" for dt in doc_types])
        
        prompt_template = await self._get_prompt("tags_are_document_types")
        prompt = prompt_template.replace("{items}", tags_text).replace("{document_types}", dt_text)
        
        try:
            response = await self.llm.complete(prompt)
            
            import re
            json_match = re.search(r'\{[\s\S]*\}', response)
            if not json_match:
                return {"doctype_tags": [], "error": "Invalid JSON response"}
            
            result = json.loads(json_match.group())
            doctype_tags = result.get("doctype_tags", [])
            
            # Enrich with tag IDs and doctype IDs
            tags_by_name = {t["name"].lower(): t for t in tags}
            dt_by_name = {dt["name"].lower(): dt for dt in doc_types}
            
            enriched = []
            for dtt in doctype_tags:
                tag_name = dtt.get("tag_name", "")
                tag_data = tags_by_name.get(tag_name.lower())
                suggested = dtt.get("suggested_doctype", "")
                dt_data = dt_by_name.get(suggested.lower())
                
                if tag_data:
                    enriched.append({
                        "tag_id": tag_data["id"],
                        "tag_name": tag_data["name"],
                        "document_count": tag_data.get("document_count", 0),
                        "suggested_doctype": suggested,
                        "doctype_id": dt_data["id"] if dt_data else None,
                        "doctype_exists": dt_data is not None,
                        "confidence": dtt.get("confidence", 0.5),
                        "reason": dtt.get("reason", "")
                    })
            
            return {
                "doctype_tags": enriched,
                "stats": {"tags_count": len(tags), "doctypes_count": len(doc_types), "found_count": len(enriched)}
            }
            
        except Exception as e:
            return {"doctype_tags": [], "error": str(e)}


async def get_similarity_service(
    paperless: PaperlessClient = Depends(get_paperless_client),
    llm: LLMProviderService = Depends(get_llm_service),
    db: AsyncSession = Depends(get_db)
) -> SimilarityService:
    """Dependency to get similarity service."""
    return SimilarityService(paperless, llm, db)
