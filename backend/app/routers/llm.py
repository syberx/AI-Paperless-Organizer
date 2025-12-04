from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.services.llm_provider import LLMProviderService, get_llm_service

router = APIRouter()


class TestPromptRequest(BaseModel):
    """Request to test a prompt."""
    prompt: str
    provider_name: Optional[str] = None


@router.post("/test")
async def test_llm_connection(
    llm_service: LLMProviderService = Depends(get_llm_service)
):
    """Test the active LLM provider connection."""
    try:
        result = await llm_service.test_connection()
        return {"success": True, "provider": result["provider"], "model": result["model"]}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/test-prompt")
async def test_prompt(
    request: TestPromptRequest,
    llm_service: LLMProviderService = Depends(get_llm_service)
):
    """Test a prompt with the active LLM provider."""
    try:
        response = await llm_service.complete(request.prompt)
        return {"success": True, "response": response}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/active-provider")
async def get_active_provider(
    llm_service: LLMProviderService = Depends(get_llm_service)
):
    """Get information about the active LLM provider."""
    provider_info = await llm_service.get_active_provider_info()
    return provider_info


@router.get("/models")
async def get_available_models(provider: str = None):
    """Get list of available models with context sizes and pricing."""
    models = LLMProviderService.get_available_models(provider)
    return {"models": models}


@router.get("/model-info/{model_id}")
async def get_model_info(model_id: str):
    """Get detailed info about a specific model."""
    info = LLMProviderService.MODEL_INFO.get(model_id)
    if not info:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")
    return {"model_id": model_id, **info}

