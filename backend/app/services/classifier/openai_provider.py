"""OpenAI classifier provider using Tool Calling + Structured Outputs."""

import json
import time
import logging
from typing import Dict, Any, List, Optional

from openai import AsyncOpenAI

from app.services.classifier.base_provider import (
    BaseClassifierProvider, ClassificationResult, DocumentContext,
)
from app.services.classifier.tool_definitions import (
    CLASSIFIER_TOOLS, CLASSIFICATION_RESULT_SCHEMA,
)
from app.services.classifier.tool_executor import ToolExecutor
from app.services.classifier.prompts import SYSTEM_PROMPT_OPENAI, get_correspondent_rules

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 10


class OpenAIToolCallingProvider(BaseClassifierProvider):
    """Classifies documents using OpenAI with tool calling.

    Flow:
    1. Send document content + tool definitions to OpenAI
    2. OpenAI may request tool calls (search_tags, search_correspondents, ...)
    3. We execute those calls locally against our Paperless cache
    4. Send results back to OpenAI
    5. Repeat until OpenAI returns the final classification
    """

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        tool_executor: Optional[ToolExecutor] = None,
        base_url: Optional[str] = None,
        provider_label: str = "OpenAI",
        extra_headers: Optional[Dict[str, str]] = None,
    ):
        kwargs: Dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        if extra_headers:
            kwargs["default_headers"] = extra_headers
        self.client = AsyncOpenAI(**kwargs)
        self.model = model
        self.tool_executor = tool_executor
        self._provider_label = provider_label

    def get_name(self) -> str:
        return f"{self._provider_label} ({self.model})"

    def supports_tool_calling(self) -> bool:
        return True

    async def test_connection(self) -> Dict[str, Any]:
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "Ping"}],
                max_tokens=5,
            )
            return {"connected": True, "model": self.model}
        except Exception as e:
            return {"connected": False, "error": str(e)}

    async def classify(
        self,
        document: DocumentContext,
        config: Dict[str, Any],
    ) -> ClassificationResult:
        start_time = time.time()
        total_input_tokens = 0
        total_output_tokens = 0
        total_tool_calls = 0

        enabled_fields = self._get_enabled_fields(config)

        system_prompt = config.get("system_prompt") or SYSTEM_PROMPT_OPENAI
        system_prompt += f"\n\nAktivierte Felder: {', '.join(enabled_fields)}"
        tags_min = config.get("tags_min", 1)
        tags_max = config.get("tags_max", 5)
        system_prompt += f"\nTag-Anzahl: Mindestens {tags_min}, maximal {tags_max} Tags."
        if "custom_fields" in enabled_fields:
            system_prompt += "\nDu MUSST get_custom_field_definitions aufrufen und die Felder extrahieren!"
        else:
            system_prompt += "\nCustom Fields sind deaktiviert, ignoriere get_custom_field_definitions."
        if "storage_path" in enabled_fields:
            system_prompt += "\nDu MUSST get_storage_paths aufrufen und einen Pfad zuordnen! storage_path_id und storage_path_reason MUESSEN im Ergebnis stehen!"
        else:
            system_prompt += "\nSpeicherpfad ist deaktiviert, ignoriere get_storage_paths."

        # Replace default rules with user-configured prompts when set.
        # If trim_prompt is enabled and no manual prompt_correspondent is set,
        # swap in the short-name variant automatically.
        from app.services.classifier.prompts import (
            RULES_TITLE, RULES_TAGS, RULES_CORRESPONDENT, RULES_DOCTYPE, RULES_DATE
        )
        trim_prompt = config.get("correspondent_trim_prompt", False)
        effective_correspondent_rule = config.get("prompt_correspondent") or (
            get_correspondent_rules(trim_prompt) if trim_prompt else None
        )
        replacements = {
            RULES_TITLE: config.get("prompt_title"),
            RULES_TAGS: config.get("prompt_tags"),
            RULES_CORRESPONDENT: effective_correspondent_rule,
            RULES_DOCTYPE: config.get("prompt_document_type"),
            RULES_DATE: config.get("prompt_date"),
        }
        for default_rule, user_rule in replacements.items():
            if user_rule and user_rule.strip():
                system_prompt = system_prompt.replace(default_rule, user_rule)

        user_content = self._build_user_message(document)
        logger.info(f"OpenAI user message length: {len(user_content)} chars")

        active_tools = self._filter_tools(config)
        logger.info(f"OpenAI active tools: {[t['function']['name'] for t in active_tools]}")

        messages: List[Dict] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

        try:
            for _round in range(MAX_TOOL_ROUNDS):
                call_kwargs: Dict[str, Any] = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.2,
                }

                if active_tools:
                    call_kwargs["tools"] = active_tools

                response = await self.client.chat.completions.create(**call_kwargs)

                usage = response.usage
                if usage:
                    total_input_tokens += usage.prompt_tokens or 0
                    total_output_tokens += usage.completion_tokens or 0

                choice = response.choices[0]

                if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
                    messages.append(choice.message.model_dump())

                    for tool_call in choice.message.tool_calls:
                        total_tool_calls += 1
                        fn_name = tool_call.function.name
                        fn_args = json.loads(tool_call.function.arguments)

                        logger.info(f"Tool call: {fn_name}({fn_args})")

                        result_str = await self.tool_executor.execute(fn_name, fn_args)

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": result_str,
                        })
                    continue

                # No more tool calls -- parse final response
                raw = choice.message.content or "{}"
                raw = raw.strip()
                if "```" in raw:
                    import re as _re
                    m = _re.search(r'```(?:json)?\s*\n(.*?)```', raw, _re.DOTALL)
                    if m:
                        raw = m.group(1).strip()
                if not raw.startswith("{"):
                    brace = raw.find("{")
                    if brace >= 0:
                        raw = raw[brace:]

                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    logger.error(f"Failed to parse JSON response: {raw[:500]}")
                    return ClassificationResult(
                        error=f"Invalid JSON from LLM: {raw[:200]}",
                        tokens_input=total_input_tokens,
                        tokens_output=total_output_tokens,
                        duration_seconds=time.time() - start_time,
                    )

                logger.info(f"OpenAI result keys: {list(data.keys())}")
                logger.info(f"OpenAI raw tags: {data.get('tags', [])}")
                if "storage_path_id" not in data:
                    logger.warning(f"OpenAI did NOT return storage_path_id! "
                                   f"Tool calls made: {total_tool_calls}")

                result = self._parse_result(
                    data, total_input_tokens, total_output_tokens,
                    total_tool_calls, start_time,
                )
                result.debug_info["content_sent_chars"] = len(user_content)
                result.debug_info["model"] = self.model
                result.debug_info["tools_called"] = total_tool_calls
                result.debug_info["raw_tags_from_llm"] = data.get("tags", [])
                return result

            return ClassificationResult(
                error=f"Max tool call rounds ({MAX_TOOL_ROUNDS}) reached",
                tokens_input=total_input_tokens,
                tokens_output=total_output_tokens,
                duration_seconds=time.time() - start_time,
            )

        except Exception as e:
            logger.error(f"OpenAI classification failed: {e}", exc_info=True)
            return ClassificationResult(
                error=str(e),
                tokens_input=total_input_tokens,
                tokens_output=total_output_tokens,
                duration_seconds=time.time() - start_time,
            )

    def _get_enabled_fields(self, config: Dict) -> List[str]:
        fields = []
        mapping = {
            "enable_title": "title",
            "enable_tags": "tags",
            "enable_correspondent": "correspondent",
            "enable_document_type": "document_type",
            "enable_storage_path": "storage_path",
            "enable_created_date": "created_date",
            "enable_custom_fields": "custom_fields",
        }
        for key, name in mapping.items():
            if config.get(key, False):
                fields.append(name)
        return fields

    def _build_user_message(self, doc: DocumentContext) -> str:
        parts = [f"Dokument-ID: {doc.document_id}"]
        if doc.current_title:
            parts.append(f"Aktueller Titel: {doc.current_title}")
        if doc.current_tags:
            parts.append(f"Aktuelle Tags: {', '.join(doc.current_tags)}")
        if doc.current_correspondent:
            parts.append(f"Aktueller Korrespondent: {doc.current_correspondent}")
        if doc.current_document_type:
            parts.append(f"Aktueller Dokumenttyp: {doc.current_document_type}")

        content = doc.content
        if len(content) > 15000:
            content = content[:15000] + "\n[... Inhalt gekuerzt ...]"

        parts.append(f"\n--- DOKUMENTINHALT ---\n{content}")
        return "\n".join(parts)

    def _filter_tools(self, config: Dict) -> List[Dict]:
        """Only include tools for enabled features."""
        tools = []
        for tool in CLASSIFIER_TOOLS:
            fn_name = tool["function"]["name"]
            if fn_name == "search_tags" and config.get("enable_tags"):
                tools.append(tool)
            elif fn_name == "search_correspondents" and config.get("enable_correspondent"):
                tools.append(tool)
            elif fn_name == "get_document_types" and config.get("enable_document_type"):
                tools.append(tool)
            elif fn_name == "get_storage_paths" and config.get("enable_storage_path"):
                tools.append(tool)
            elif fn_name == "get_custom_field_definitions" and config.get("enable_custom_fields"):
                tools.append(tool)
        return tools

    def _parse_result(
        self, data: Dict, input_tokens: int, output_tokens: int,
        tool_calls: int, start_time: float,
    ) -> ClassificationResult:
        model_info = {
            "gpt-4o-mini": (0.15, 0.60),
            "gpt-4o": (2.50, 10.00),
            "mistral-small-latest": (0.10, 0.30),
            "mistral-medium-latest": (0.40, 1.20),
            "mistral-large-latest": (2.00, 6.00),
            "codestral-latest": (0.30, 0.90),
            "open-mistral-nemo": (0.15, 0.15),
            "ministral-8b-latest": (0.10, 0.10),
        }
        input_price, output_price = model_info.get(self.model, (0.15, 0.60))
        cost = (input_tokens * input_price + output_tokens * output_price) / 1_000_000

        return ClassificationResult(
            title=data.get("title"),
            tags=data.get("tags", []),
            correspondent=data.get("correspondent"),
            document_type=data.get("document_type"),
            storage_path_id=data.get("storage_path_id"),
            storage_path_reason=data.get("storage_path_reason"),
            created_date=data.get("created_date"),
            custom_fields=data.get("custom_fields", {}),
            tokens_input=input_tokens,
            tokens_output=output_tokens,
            cost_usd=cost,
            duration_seconds=time.time() - start_time,
            tool_calls_count=tool_calls,
        )
