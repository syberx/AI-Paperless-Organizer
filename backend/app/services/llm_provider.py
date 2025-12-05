"""LLM Provider abstraction layer supporting multiple providers."""

import json
import re
from typing import Optional, Dict, Any
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import LLMProvider


class LLMProviderService:
    """Service for interacting with various LLM providers."""
    
    # Comprehensive model info: context window, pricing per 1M tokens
    MODEL_INFO = {
        # OpenAI Models (December 2024)
        "gpt-4o": {
            "context": 128000,
            "input_price": 2.50,
            "output_price": 10.00,
            "description": "Flagship model, fast & capable",
            "provider": "openai"
        },
        "gpt-4o-mini": {
            "context": 128000,
            "input_price": 0.15,
            "output_price": 0.60,
            "description": "Günstig & schnell für einfache Tasks",
            "provider": "openai"
        },
        "gpt-4-turbo": {
            "context": 128000,
            "input_price": 10.00,
            "output_price": 30.00,
            "description": "Vorgänger von GPT-4o",
            "provider": "openai"
        },
        "gpt-4": {
            "context": 8192,
            "input_price": 30.00,
            "output_price": 60.00,
            "description": "Original GPT-4 (kleiner Context)",
            "provider": "openai"
        },
        "gpt-3.5-turbo": {
            "context": 16385,
            "input_price": 0.50,
            "output_price": 1.50,
            "description": "Legacy, günstig aber weniger fähig",
            "provider": "openai"
        },
        "o1-preview": {
            "context": 128000,
            "input_price": 15.00,
            "output_price": 60.00,
            "description": "Reasoning-Modell für komplexe Aufgaben",
            "provider": "openai"
        },
        "o1-mini": {
            "context": 128000,
            "input_price": 3.00,
            "output_price": 12.00,
            "description": "Schnelleres Reasoning-Modell",
            "provider": "openai"
        },
        # Anthropic Claude Models (December 2024)
        "claude-3-5-sonnet-20241022": {
            "context": 200000,
            "input_price": 3.00,
            "output_price": 15.00,
            "description": "Neuestes Sonnet - beste Balance",
            "provider": "anthropic"
        },
        "claude-3-5-haiku-20241022": {
            "context": 200000,
            "input_price": 0.80,
            "output_price": 4.00,
            "description": "Schnell & günstig",
            "provider": "anthropic"
        },
        "claude-3-opus-20240229": {
            "context": 200000,
            "input_price": 15.00,
            "output_price": 75.00,
            "description": "Stärkstes Claude - teuer aber sehr fähig",
            "provider": "anthropic"
        },
        "claude-3-sonnet-20240229": {
            "context": 200000,
            "input_price": 3.00,
            "output_price": 15.00,
            "description": "Älteres Sonnet",
            "provider": "anthropic"
        },
        "claude-3-haiku-20240307": {
            "context": 200000,
            "input_price": 0.25,
            "output_price": 1.25,
            "description": "Günstigstes Claude",
            "provider": "anthropic"
        },
        # Ollama / Local Models
        "llama3.2": {
            "context": 128000,
            "input_price": 0,
            "output_price": 0,
            "description": "Lokal - kostenlos (Meta)",
            "provider": "ollama"
        },
        "llama3.1": {
            "context": 128000,
            "input_price": 0,
            "output_price": 0,
            "description": "Lokal - kostenlos (Meta)",
            "provider": "ollama"
        },
        "llama3": {
            "context": 8192,
            "input_price": 0,
            "output_price": 0,
            "description": "Lokal - kostenlos (Meta)",
            "provider": "ollama"
        },
        "mistral": {
            "context": 32768,
            "input_price": 0,
            "output_price": 0,
            "description": "Lokal - kostenlos (Mistral AI)",
            "provider": "ollama"
        },
        "mixtral": {
            "context": 32768,
            "input_price": 0,
            "output_price": 0,
            "description": "Lokal - MoE Modell (Mistral AI)",
            "provider": "ollama"
        },
        "qwen2.5": {
            "context": 32768,
            "input_price": 0,
            "output_price": 0,
            "description": "Lokal - kostenlos (Alibaba)",
            "provider": "ollama"
        },
        "gemma2": {
            "context": 8192,
            "input_price": 0,
            "output_price": 0,
            "description": "Lokal - kostenlos (Google)",
            "provider": "ollama"
        },
    }
    
    # Token limits per model (context window - leave buffer for output)
    MODEL_TOKEN_LIMITS = {k: int(v["context"] * 0.95) for k, v in MODEL_INFO.items()}
    
    # Default limits per provider if model not found
    DEFAULT_TOKEN_LIMITS = {
        "openai": 120000,      # Assume modern model
        "anthropic": 190000,   # Claude models have huge context
        "azure": 7000,         # Conservative
        "ollama": 7000,        # Conservative
    }
    
    @classmethod
    def get_available_models(cls, provider: str = None) -> list:
        """Get list of available models with their info."""
        models = []
        for model_id, info in cls.MODEL_INFO.items():
            if provider is None or info["provider"] == provider:
                models.append({
                    "id": model_id,
                    "provider": info["provider"],
                    "context": info["context"],
                    "input_price": info["input_price"],
                    "output_price": info["output_price"],
                    "description": info["description"]
                })
        return models
    
    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider
    
    async def get_active_provider_info(self) -> Dict:
        """Get information about the active provider."""
        if not self.provider:
            return {"configured": False, "provider": None}
        
        return {
            "configured": True,
            "provider": self.provider.name,
            "display_name": self.provider.display_name,
            "model": self.provider.model
        }
    
    async def test_connection(self) -> Dict:
        """Test connection to the active LLM provider."""
        if not self.provider:
            raise ValueError("No LLM provider configured")
        
        # Simple test prompt
        response = await self.complete("Antworte nur mit: OK")
        
        return {
            "provider": self.provider.name,
            "model": self.provider.model,
            "response": response
        }
    
    async def complete(self, prompt: str) -> str:
        """Send a completion request to the active LLM provider."""
        if not self.provider:
            raise ValueError("No LLM provider configured")
        
        if self.provider.name == "openai":
            return await self._complete_openai(prompt)
        elif self.provider.name == "anthropic":
            return await self._complete_anthropic(prompt)
        elif self.provider.name == "azure":
            return await self._complete_azure(prompt)
        elif self.provider.name == "ollama":
            return await self._complete_ollama(prompt)
        else:
            raise ValueError(f"Unknown provider: {self.provider.name}")
    
    async def _complete_openai(self, prompt: str) -> str:
        """Complete using OpenAI API."""
        from openai import AsyncOpenAI
        
        client = AsyncOpenAI(api_key=self.provider.api_key)
        
        response = await client.chat.completions.create(
            model=self.provider.model or "gpt-4o",
            messages=[
                {"role": "system", "content": "Du bist ein hilfreicher Assistent für Dokumentenmanagement. Antworte immer mit vollständigem, validem JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=16384  # Increased for large responses
        )
        
        return response.choices[0].message.content
    
    async def _complete_anthropic(self, prompt: str) -> str:
        """Complete using Anthropic API."""
        from anthropic import AsyncAnthropic
        
        client = AsyncAnthropic(api_key=self.provider.api_key)
        
        response = await client.messages.create(
            model=self.provider.model or "claude-3-5-sonnet-20241022",
            max_tokens=8192,
            system="Du bist ein hilfreicher Assistent für Dokumentenmanagement. Antworte immer mit vollständigem, validem JSON.",
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        return response.content[0].text
    
    async def _complete_azure(self, prompt: str) -> str:
        """Complete using Azure OpenAI API."""
        from openai import AsyncAzureOpenAI
        
        client = AsyncAzureOpenAI(
            api_key=self.provider.api_key,
            api_version="2024-02-15-preview",
            azure_endpoint=self.provider.api_base_url
        )
        
        response = await client.chat.completions.create(
            model=self.provider.model or "gpt-4",
            messages=[
                {"role": "system", "content": "Du bist ein hilfreicher Assistent für Dokumentenmanagement. Antworte immer mit vollständigem, validem JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=16384
        )
        
        return response.choices[0].message.content
    
    async def _complete_ollama(self, prompt: str) -> str:
        """Complete using local Ollama."""
        import httpx
        
        base_url = self.provider.api_base_url or "http://localhost:11434"
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{base_url}/api/generate",
                json={
                    "model": self.provider.model or "llama3.1",
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.3
                    }
                }
            )
            response.raise_for_status()
            result = response.json()
            return result.get("response", "")
    
    def estimate_tokens(self, text: str) -> int:
        """Estimate token count (rough approximation: ~4 chars per token for German/English)."""
        return len(text) // 4
    
    def get_token_limit(self) -> int:
        """Get the token limit for the current provider/model."""
        if not self.provider:
            return 7000  # Conservative default
        
        model = self.provider.model or ""
        
        # Check model-specific limits
        if model in self.MODEL_TOKEN_LIMITS:
            return self.MODEL_TOKEN_LIMITS[model]
        
        # Check provider defaults
        if self.provider.name in self.DEFAULT_TOKEN_LIMITS:
            return self.DEFAULT_TOKEN_LIMITS[self.provider.name]
        
        return 7000  # Conservative fallback
    
    def get_model_info(self) -> Optional[Dict[str, Any]]:
        """Get info about the current model."""
        if not self.provider:
            return None
        
        model = self.provider.model or ""
        provider_name = self.provider.name or ""
        
        # Check if we have detailed info for this model
        if model in self.MODEL_INFO:
            info = self.MODEL_INFO[model].copy()
            info["model"] = model
            info["provider_name"] = provider_name
            return info
        
        # Return basic info
        return {
            "model": model or "Nicht konfiguriert",
            "provider_name": provider_name,
            "context": self.get_token_limit()
        }
    
    async def analyze_for_similarity(self, prompt_template: str, items: list) -> Dict:
        """Analyze items for similarity using the configured LLM."""
        import logging
        logger = logging.getLogger(__name__)
        
        if not items:
            return {"groups": [], "stats": {"items_count": 0, "estimated_tokens": 0}}
        
        # Format items as a list
        items_str = json.dumps([item["name"] for item in items], ensure_ascii=False, indent=2)
        
        # Fill in the prompt template
        prompt = prompt_template.replace("{items}", items_str)
        
        # Estimate tokens
        estimated_input_tokens = self.estimate_tokens(prompt)
        
        logger.info(f"[LLM] Analyzing {len(items)} items, estimated tokens: {estimated_input_tokens}")
        
        # Check if likely too large
        token_warning = None
        max_recommended = 8000  # Safe limit for most models
        if estimated_input_tokens > max_recommended:
            token_warning = f"Viele Items ({len(items)})! Geschätzte Tokens: ~{estimated_input_tokens}. Könnte das Limit überschreiten."
        
        # Get LLM response
        logger.info(f"[LLM] Sending request to LLM provider...")
        response = await self.complete(prompt)
        logger.info(f"[LLM] Got response, length: {len(response)} chars, first 200: {response[:200]}")
        
        # Estimate output tokens
        estimated_output_tokens = self.estimate_tokens(response)
        
        # Build stats
        stats = {
            "items_count": len(items),
            "estimated_input_tokens": estimated_input_tokens,
            "estimated_output_tokens": estimated_output_tokens,
            "estimated_total_tokens": estimated_input_tokens + estimated_output_tokens,
            "warning": token_warning
        }
        
        # Parse JSON from response
        try:
            # Try to extract JSON from the response
            json_match = re.search(r'\{[\s\S]*\}', response)
            if json_match:
                json_str = json_match.group()
                
                # Try to fix common JSON errors
                # 1. Remove trailing commas before } or ]
                json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)
                # 2. Remove any control characters
                json_str = re.sub(r'[\x00-\x1f\x7f-\x9f]', ' ', json_str)
                
                result = None
                parse_error = None
                
                # Attempt 1: Direct parse
                try:
                    result = json.loads(json_str)
                except json.JSONDecodeError as e:
                    parse_error = e
                    logger.warning(f"[LLM] JSON parse attempt 1 failed: {e}")
                
                # Attempt 2: Find balanced JSON
                if result is None:
                    try:
                        depth = 0
                        last_valid = 0
                        in_string = False
                        escape_next = False
                        
                        for i, c in enumerate(json_str):
                            if escape_next:
                                escape_next = False
                                continue
                            if c == '\\':
                                escape_next = True
                                continue
                            if c == '"' and not escape_next:
                                in_string = not in_string
                                continue
                            if in_string:
                                continue
                            if c == '{':
                                depth += 1
                            elif c == '}':
                                depth -= 1
                                if depth == 0:
                                    last_valid = i + 1
                                    break
                        
                        if last_valid > 0:
                            json_str = json_str[:last_valid]
                            result = json.loads(json_str)
                            logger.info(f"[LLM] JSON parse attempt 2 succeeded (truncated to {last_valid} chars)")
                    except json.JSONDecodeError as e:
                        parse_error = e
                        logger.warning(f"[LLM] JSON parse attempt 2 failed: {e}")
                
                # Attempt 3: Try to extract just the groups array
                if result is None:
                    try:
                        groups_match = re.search(r'"groups"\s*:\s*\[([\s\S]*?)\](?=\s*[,}]|$)', json_str)
                        if groups_match:
                            # Find complete group objects
                            groups_content = groups_match.group(1)
                            # Extract individual group objects
                            group_objects = []
                            depth = 0
                            start = -1
                            in_str = False
                            esc = False
                            
                            for i, c in enumerate(groups_content):
                                if esc:
                                    esc = False
                                    continue
                                if c == '\\':
                                    esc = True
                                    continue
                                if c == '"':
                                    in_str = not in_str
                                    continue
                                if in_str:
                                    continue
                                if c == '{':
                                    if depth == 0:
                                        start = i
                                    depth += 1
                                elif c == '}':
                                    depth -= 1
                                    if depth == 0 and start >= 0:
                                        try:
                                            obj = json.loads(groups_content[start:i+1])
                                            group_objects.append(obj)
                                        except:
                                            pass
                                        start = -1
                            
                            if group_objects:
                                result = {"groups": group_objects}
                                logger.info(f"[LLM] JSON parse attempt 3 succeeded, extracted {len(group_objects)} groups")
                    except Exception as e:
                        logger.warning(f"[LLM] JSON parse attempt 3 failed: {e}")
                
                if result is None:
                    raise parse_error or json.JSONDecodeError("Could not parse JSON", json_str, 0)
                
                # Enrich groups with IDs from original items
                items_dict = {item["name"]: item for item in items}
                # Also create lowercase lookup for fuzzy matching
                items_dict_lower = {item["name"].lower(): item for item in items}
                
                for group in result.get("groups", []):
                    enriched_members = []
                    for member_name in group.get("members", []):
                        matched = False
                        
                        # 1. Exact match
                        if member_name in items_dict:
                            enriched_members.append(items_dict[member_name])
                            matched = True
                        # 2. Case-insensitive match
                        elif member_name.lower() in items_dict_lower:
                            enriched_members.append(items_dict_lower[member_name.lower()])
                            matched = True
                        else:
                            # 3. Fuzzy match - check if member_name is contained in any item name or vice versa
                            for name, item in items_dict.items():
                                if (member_name.lower() in name.lower() or 
                                    name.lower() in member_name.lower() or
                                    member_name.lower().replace(" ", "") == name.lower().replace(" ", "")):
                                    enriched_members.append(item)
                                    matched = True
                                    break
                        
                        if not matched:
                            logger.warning(f"[LLM] Member '{member_name}' not found in items!")
                    
                    group["members"] = enriched_members
                    if len(enriched_members) < len(group.get("members", [])):
                        logger.warning(f"[LLM] Group '{group.get('suggested_name')}': Only {len(enriched_members)} of {len(group.get('members', []))} members matched")
                
                result["stats"] = stats
                return result
            else:
                return {"groups": [], "error": "Keine JSON-Antwort vom LLM erhalten", "stats": stats, "raw_response": response[:500]}
        except json.JSONDecodeError as e:
            # Return partial info for debugging
            error_context = response[max(0, e.pos-100):e.pos+100] if hasattr(e, 'pos') else response[:200]
            return {
                "groups": [], 
                "error": f"JSON-Fehler: {str(e)}. Kontext: ...{error_context}...", 
                "stats": stats
            }


async def get_llm_service(db: AsyncSession = Depends(get_db)) -> LLMProviderService:
    """Dependency to get LLM service with active provider."""
    result = await db.execute(
        select(LLMProvider).where(LLMProvider.is_active == True)
    )
    provider = result.scalar_one_or_none()
    
    return LLMProviderService(provider)

