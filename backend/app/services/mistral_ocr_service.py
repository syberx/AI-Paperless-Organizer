"""Mistral OCR Service — uses Mistral's dedicated OCR API endpoint.

Completely separate from the Ollama Vision OCR. Sends PDFs directly
to Mistral's /v1/ocr endpoint which returns structured text per page.

API Docs: https://docs.mistral.ai/api/endpoint/ocr
Model: mistral-ocr-latest
"""

import base64
import httpx
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr"
MISTRAL_OCR_MODEL = "mistral-ocr-latest"


async def mistral_ocr_document(
    pdf_bytes: bytes,
    api_key: str,
    model: str = MISTRAL_OCR_MODEL,
    include_image_base64: bool = False,
) -> Dict:
    """Send a PDF to Mistral OCR and get back structured text.

    Args:
        pdf_bytes: Raw PDF file bytes
        api_key: Mistral API key
        model: OCR model name (default: mistral-ocr-latest)
        include_image_base64: Whether to include page images in response

    Returns:
        {
            "pages": [{"page": 1, "text": "..."}, ...],
            "full_text": "all pages combined",
            "page_count": N,
        }
    """
    pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")

    # Mistral expects a data URL when sending base64 (type must be "document_url")
    request_body = {
        "model": model,
        "document": {
            "type": "document_url",
            "document_url": f"data:application/pdf;base64,{pdf_b64}",
        },
    }

    if include_image_base64:
        request_body["include_image_base64"] = True

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    logger.info(f"Mistral OCR: sending {len(pdf_bytes)} bytes PDF to {MISTRAL_OCR_URL}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            MISTRAL_OCR_URL,
            json=request_body,
            headers=headers,
        )

        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"Mistral OCR error {response.status_code}: {error_text}")
            raise RuntimeError(f"Mistral OCR Fehler ({response.status_code}): {error_text}")

        data = response.json()

    # Parse response — Mistral returns pages with markdown content
    pages = []
    full_text_parts = []

    # Response format: {"pages": [{"index": 0, "markdown": "...", "images": [...]}]}
    for page_data in data.get("pages", []):
        page_num = page_data.get("index", 0) + 1
        text = page_data.get("markdown", "") or page_data.get("text", "")
        pages.append({
            "page": page_num,
            "text": text,
        })
        if text.strip():
            full_text_parts.append(text.strip())

    full_text = "\n\n".join(full_text_parts)

    logger.info(f"Mistral OCR: {len(pages)} pages, {len(full_text)} chars total")

    return {
        "pages": pages,
        "full_text": full_text,
        "page_count": len(pages),
    }


async def test_mistral_ocr_connection(api_key: str) -> Dict:
    """Test if the Mistral OCR API is reachable with the given key."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Use a minimal request to test auth
            response = await client.get(
                "https://api.mistral.ai/v1/models",
                headers=headers,
            )
            if response.status_code == 200:
                models = response.json().get("data", [])
                ocr_models = [m["id"] for m in models if "ocr" in m.get("id", "").lower()]
                return {
                    "connected": True,
                    "ocr_models": ocr_models or [MISTRAL_OCR_MODEL],
                }
            else:
                return {"connected": False, "error": f"HTTP {response.status_code}"}
    except Exception as e:
        return {"connected": False, "error": str(e)}
