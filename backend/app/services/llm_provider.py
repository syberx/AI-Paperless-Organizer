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
                {"role": "system", "content": "Du bist ein hilfreicher Assistent für Dokumentenmanagement."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=4096
        )
        
        return response.choices[0].message.content
    
    async def _complete_anthropic(self, prompt: str) -> str:
        """Complete using Anthropic API."""
        from anthropic import AsyncAnthropic
        
        client = AsyncAnthropic(api_key=self.provider.api_key)
        
        response = await client.messages.create(
            model=self.provider.model or "claude-3-5-sonnet-20241022",
            max_tokens=4096,
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
                {"role": "system", "content": "Du bist ein hilfreicher Assistent für Dokumentenmanagement."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=4096
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
    
    async def analyze_for_similarity(self, prompt_template: str, items: list) -> Dict:
        """Analyze items for similarity using the configured LLM."""
        if not items:
            return {"groups": [], "stats": {"items_count": 0, "estimated_tokens": 0}}
        
        # Format items as a list
        items_str = json.dumps([item["name"] for item in items], ensure_ascii=False, indent=2)
        
        # Fill in the prompt template
        prompt = prompt_template.replace("{items}", items_str)
        
        # Estimate tokens
        estimated_input_tokens = self.estimate_tokens(prompt)
        
        # Check if likely too large
        token_warning = None
        max_recommended = 8000  # Safe limit for most models
        if estimated_input_tokens > max_recommended:
            token_warning = f"Viele Items ({len(items)})! Geschätzte Tokens: ~{estimated_input_tokens}. Könnte das Limit überschreiten."
        
        # Get LLM response
        response = await self.complete(prompt)
        
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
                result = json.loads(json_match.group())
                
                # Enrich groups with IDs from original items
                items_dict = {item["name"]: item for item in items}
                for group in result.get("groups", []):
                    enriched_members = []
                    for member_name in group.get("members", []):
                        if member_name in items_dict:
                            enriched_members.append(items_dict[member_name])
                        else:
                            # Try case-insensitive match
                            for name, item in items_dict.items():
                                if name.lower() == member_name.lower():
                                    enriched_members.append(item)
                                    break
                    group["members"] = enriched_members
                
                result["stats"] = stats
                return result
            else:
                return {"groups": [], "error": "Could not parse JSON from response", "stats": stats}
        except json.JSONDecodeError as e:
            return {"groups": [], "error": f"JSON parse error: {str(e)}", "stats": stats}


async def get_llm_service(db: AsyncSession = Depends(get_db)) -> LLMProviderService:
    """Dependency to get LLM service with active provider."""
    result = await db.execute(
        select(LLMProvider).where(LLMProvider.is_active == True)
    )
    provider = result.scalar_one_or_none()
    
    return LLMProviderService(provider)

