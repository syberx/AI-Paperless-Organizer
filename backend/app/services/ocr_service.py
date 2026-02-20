"""OCR Service using Ollama Vision models."""

import base64
import httpx
import asyncio
import json
import logging
import time
import io
from pathlib import Path
from typing import Optional, Dict, List, Any
from PIL import Image
from pdf2image import convert_from_bytes

logger = logging.getLogger(__name__)

# Default OCR settings
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_OCR_MODEL = "qwen2.5vl:7b"

# Tag names for OCR workflow
TAG_RUN_OCR = "runocr"
TAG_OCR_FINISH = "ocrfinish"

# Batch job state (in-memory, single instance)
batch_state = {
    "running": False,
    "should_stop": False,
    "total": 0,
    "processed": 0,
    "current_document": None,
    "errors": [],
    "log": [],
    "mode": None,
    "paused": False
}

# Track single OCR to prevent watchdog conflicts
single_ocr_running = False

# Review queue file
REVIEW_QUEUE_FILE = Path("/app/data/ocr_review_queue.json")
# OCR Ignore list: document IDs to permanently skip in future OCR runs
OCR_IGNORE_FILE = Path("/app/data/ocr_ignore_list.json")

# Quality threshold: if new text is less than this ratio of old text, flag for review
QUALITY_THRESHOLD = 0.5

def load_review_queue() -> List[Dict]:
    """Load review queue from file."""
    try:
        if REVIEW_QUEUE_FILE.exists():
            return json.loads(REVIEW_QUEUE_FILE.read_text())
    except Exception:
        pass
    return []

def save_review_queue(queue: List[Dict]):
    """Save review queue to file."""
    try:
        REVIEW_QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
        REVIEW_QUEUE_FILE.write_text(json.dumps(queue, ensure_ascii=False, indent=2))
    except Exception as e:
        logger.error(f"Error saving review queue: {e}")

def load_ocr_ignore_list() -> List[Dict]:
    """Load OCR ignore list from file."""
    try:
        if OCR_IGNORE_FILE.exists():
            return json.loads(OCR_IGNORE_FILE.read_text())
    except Exception:
        pass
    return []

def save_ocr_ignore_list(ignore_list: List[Dict]):
    """Save OCR ignore list to file."""
    try:
        OCR_IGNORE_FILE.parent.mkdir(parents=True, exist_ok=True)
        OCR_IGNORE_FILE.write_text(json.dumps(ignore_list, ensure_ascii=False, indent=2))
    except Exception as e:
        logger.error(f"Error saving OCR ignore list: {e}")

def get_ocr_ignored_ids() -> set:
    """Get set of document IDs that should be skipped in OCR."""
    return {item["document_id"] for item in load_ocr_ignore_list()}

# Watchdog state
watchdog_state = {
    "enabled": False,
    "running": False,
    "interval_minutes": 1,
    "last_run": None,
    "task": None  # asyncio.Task
}


class OcrService:
    """Service for OCR using Ollama Vision models."""
    
    def __init__(self, ollama_url: str = DEFAULT_OLLAMA_URL, model: str = DEFAULT_OCR_MODEL, ollama_urls: List[str] = None, max_image_size: int = 1344, smart_skip_enabled: bool = False):
        if ollama_urls and len(ollama_urls) > 0:
            self.ollama_urls = [u.rstrip("/") for u in ollama_urls if u.strip()]
        else:
            self.ollama_urls = [ollama_url.rstrip("/")]
            
        self.current_url_index = 0
        self.model = model
        self.max_image_size = max_image_size
        self.smart_skip_enabled = smart_skip_enabled
    
    def get_current_url(self) -> str:
        if not self.ollama_urls:
            return DEFAULT_OLLAMA_URL
        return self.ollama_urls[self.current_url_index]

    def rotate_url(self):
        if len(self.ollama_urls) > 1:
            self.current_url_index = (self.current_url_index + 1) % len(self.ollama_urls)
            logger.info(f"Rotated to next Ollama URL: {self.get_current_url()}")
            print(f"[OCR] Switched to backup server: {self.get_current_url()}")
    
    async def test_connection(self) -> Dict[str, Any]:
        """Test connection to Ollama and check if the model is available.
        Attempts all configured URLs until one works.
        """
        last_error = None
        for url in self.ollama_urls:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    # Check Ollama is running
                    response = await client.get(f"{url}/api/tags")
                    response.raise_for_status()
                    models = response.json().get("models", [])
                    model_names = [m.get("name", "") for m in models]
                    
                    # Check if our model is available
                    model_available = any(
                        self.model in name or name.startswith(self.model.split(":")[0])
                        for name in model_names
                    )
                    
                    return {
                        "connected": True,
                        "model_available": model_available,
                        "available_models": model_names,
                        "requested_model": self.model,
                        "url": url
                    }
            except Exception as e:
                logger.warning(f"Connection test failed for {url}: {e}")
                last_error = str(e)
        
        return {
            "connected": False, 
            "model_available": False, 
            "error": f"Alle Versuche fehlgeschlagen. Letzter Fehler: {last_error}",
            "tried_urls": self.ollama_urls
        }
    
    @staticmethod
    def get_model_params(model_name: str) -> dict:
        """Get optimal OCR parameters based on model name/size.
        
        Model-specific overrides come first (deepseek-ocr, glm-ocr, etc.)
        then generic size-based defaults for Qwen and similar.
        """
        name = model_name.lower()

        # ── deepseek-ocr (3.3B, own encoder, needs <|grounding|> prompt) ──
        if "deepseek-ocr" in name:
            return {
                "max_image_size": 1344,
                "render_dpi": 300,
                "num_ctx": 8192,
                "num_predict": 8192,
                "repeat_penalty": 1.4,
                "temperature": 0.1,
            }

        # ── glm-ocr (1.1B, GLM-V encoder-decoder, 128K context) ──
        if "glm-ocr" in name or "glm_ocr" in name:
            return {
                "max_image_size": 1344,
                "render_dpi": 300,
                "num_ctx": 8192,
                "num_predict": 8192,
                "repeat_penalty": 1.3,
                "temperature": 0.1,
            }

        # ── gemma3 (echoes long prompts, keep image small) ──
        if "gemma3" in name or "gemma-3" in name:
            return {
                "max_image_size": 1344,
                "render_dpi": 300,
                "num_ctx": 8192,
                "num_predict": 8192,
                "repeat_penalty": 1.3,
                "temperature": 0.1,
            }

        # ── minicpm-v (8B, strong OCR, supports up to 1.8M pixels) ──
        if "minicpm" in name:
            return {
                "max_image_size": 1344,
                "render_dpi": 300,
                "num_ctx": 8192,
                "num_predict": 8192,
                "repeat_penalty": 1.2,
                "temperature": 0.1,
            }
        
        # ── Generic size-based defaults (Qwen, etc.) ──
        # render_dpi=400 gives high-quality source for downscaling (A4 @ 400 DPI = ~3307x4677px)
        # max_image_size controls the final pixel size sent to the model
        param_size = 0
        if ":1b" in name or ":1.5b" in name or ":2b" in name or ":3b" in name:
            param_size = 3
        elif ":4b" in name or ":5b" in name:
            param_size = 4
        elif ":7b" in name or ":8b" in name:
            param_size = 8
        elif ":13b" in name or ":14b" in name or ":15b" in name:
            param_size = 14
        elif ":32b" in name or ":34b" in name:
            param_size = 32
        elif ":70b" in name or ":72b" in name:
            param_size = 70
        else:
            param_size = 4  # Conservative default
        
        if param_size <= 4:
            return {
                "max_image_size": 1344,
                "render_dpi": 400,
                "num_ctx": 8192,
                "num_predict": 8192,
                "repeat_penalty": 1.3,
                "temperature": 0.1,
            }
        elif param_size <= 8:
            return {
                "max_image_size": 1344,
                "render_dpi": 400,
                "num_ctx": 16384,
                "num_predict": 16384,
                "repeat_penalty": 1.3,
                "temperature": 0.1,
            }
        elif param_size <= 14:
            return {
                "max_image_size": 1680,
                "render_dpi": 400,
                "num_ctx": 16384,
                "num_predict": 16384,
                "repeat_penalty": 1.35,
                "temperature": 0.1,
            }
        else:
            return {
                "max_image_size": 2016,
                "render_dpi": 400,
                "num_ctx": 32768,
                "num_predict": 16384,
                "repeat_penalty": 1.1,
                "temperature": 0.1,
            }

    def _prepare_image_for_ollama(self, img: Image.Image, max_size: int = None) -> bytes:
        """Convert PIL Image to PNG bytes, resized and aligned for Ollama Vision.
        
        qwen2.5vl requires dimensions visible by 28.
        Uses configured max_image_size (default 1344) or override.
        """
        target_size = max_size if max_size is not None else self.max_image_size
        try:
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            
            w, h = img.size
            if max(w, h) > target_size:
                ratio = target_size / max(w, h)
                w = int(w * ratio)
                h = int(h * ratio)
            
            # Round dimensions to nearest multiple of 28 (patch size for qwen2.5vl)
            w = max(28, (w // 28) * 28)
            h = max(28, (h // 28) * 28)
            
            img = img.resize((w, h), Image.LANCZOS)
            logger.info(f"Prepared image size: {w}x{h}")
            
            output = io.BytesIO()
            img.save(output, format="PNG")
            return output.getvalue()
        except Exception as e:
            logger.error(f"Image preparation failed: {e}")
            raise ValueError(f"Bildvorbereitung fehlgeschlagen: {e}")

    async def find_best_server(self) -> bool:
        """Find the first working server and set it as current. Returns True if one is found."""
        for i, url in enumerate(self.ollama_urls):
            try:
                # Short timeout for checking availability
                async with httpx.AsyncClient(timeout=3.0) as client:
                    response = await client.get(f"{url}/api/tags")
                    if response.status_code == 200:
                        self.current_url_index = i
                        logger.info(f"Connected to fast server: {url}")
                        return True
            except Exception:
                continue
        return False

    @staticmethod
    def _strip_reasoning(text: str) -> str:
        """Remove <think>...</think> reasoning blocks from model output.
        Inspired by paperless-gpt's stripReasoning approach."""
        import re
        cleaned = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
        return cleaned if cleaned else text.strip()

    @staticmethod
    def _strip_ocr_commentary(text: str) -> str:
        """Remove trailing meta-commentary (e.g. 'Got it, let me transcribe...') from OCR output.
        Keeps only the actual transcribed document text."""
        if not text or len(text) < 100:
            return text
        lines = text.split("\n")
        # Patterns that start model commentary/description (English + German)
        commentary_starts = (
            "got it", "let me ", "let's ", "first,", "first i ", "i need to ", "starting from",
            "wait,", "let's check", "okay,", "so,", "now,", "i'll ", "i will ",
            "transcribe this", "go through each", "making sure not to miss",
            "die bild zeigt", "im bild steht", "zuerst muss ich"
        )
        for i, line in enumerate(lines):
            stripped = line.strip().lower()
            if not stripped:
                continue
            if any(stripped.startswith(p) or p in stripped[:50] for p in commentary_starts):
                # Keep everything before this line (the actual transcription)
                before = "\n".join(lines[:i]).strip()
                if len(before) > 80:
                    return before
        return text

    def _build_ocr_prompt(self, page_num: int = 0, total_pages: int = 0) -> str:
        """Build model-specific OCR prompt.
        
        Based on paperless-gpt's proven universal prompt as baseline.
        Model-specific adjustments only where absolutely needed:
        - deepseek-ocr: Minimal prompt (echoes anything longer)
        - glm-ocr: Keyword format per official docs
        - gemma3: Shorter version (echoes long prompts)
        - minicpm-v / qwen (default): Full paperless-gpt style prompt
        """
        name = (self.model or "").lower()

        # ── deepseek-ocr: ultra-minimal, NO <|grounding|> (that's for bounding boxes!) ──
        if "deepseek-ocr" in name:
            return "OCR this document."

        # ── glm-ocr: keyword-based per official Ollama docs ──
        if "glm-ocr" in name or "glm_ocr" in name:
            return "Text Recognition:"

        # ── gemma3: shorter prompt (echoes/repeats long prompts verbatim) ──
        if "gemma3" in name or "gemma-3" in name:
            prompt = (
                "Just transcribe the text in this image. Preserve the formatting and layout. "
                "Be thorough, continue until the bottom of the page. "
                "Use markdown format but without a code block."
            )
            if page_num > 0 and total_pages > 0:
                prompt += f" This is page {page_num} of {total_pages}."
            return prompt

        # ── Default: paperless-gpt proven prompt + German hints ──
        # Works for: qwen2.5vl, qwen3-vl, minicpm-v, and other full-featured models
        parts = [
            "Just transcribe the text in this image and preserve the formatting and layout (high quality OCR).",
            "Do that for ALL the text in the image. Be thorough and pay attention. This is very important.",
            "The image is from a text document so be sure to continue until the bottom of the page.",
            "Thanks a lot! You tend to forget about some text in the image so please focus!",
            "Use markdown format but without a code block.",
        ]
        if page_num > 0 and total_pages > 0:
            parts.append(f"This is page {page_num} of {total_pages}.")
        parts.append(
            "The document is likely in German. "
            "Pay special attention to: names, dates (DD.MM.YYYY), "
            "IBANs, BIC codes, account numbers, monetary amounts, and addresses. "
            "Transcribe everything exactly as shown."
        )
        return "\n".join(parts)

    @staticmethod
    def _clean_repetitions(text: str) -> str:
        """Detect and remove repetition loops from OCR output.
        
        Handles two cases:
        1. Instruction echo: model repeats the prompt/instruction 20+ times → truncate
        2. Content loops: same line appears many times → keep up to 6, skip the rest
        
        Conservative thresholds to avoid destroying real table data
        (e.g. "1.0 Stck." appearing 5x in a product list is legitimate).
        """
        lines = text.split('\n')
        if len(lines) < 5:
            return text

        # Phase 1: Detect extreme instruction echo (20+ identical consecutive lines)
        # Only for true model glitches, not legitimate table entries
        run_start = 0
        last_stripped = ""
        run_count = 0
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped and stripped == last_stripped:
                run_count += 1
                if run_count >= 20:
                    lines = lines[:run_start]
                    print(f"[OCR] Instruction echo detected at line {run_start}, truncating")
                    break
            else:
                run_start = i
                run_count = 1 if stripped else 0
                last_stripped = stripped

        if len(lines) < 10:
            return "\n".join(lines).strip()

        # Phase 2: Collapse moderate repetitions (keep up to 6 identical consecutive lines)
        cleaned = []
        repeat_count = 0
        last_line = ""

        for line in lines:
            stripped = line.strip()
            if stripped == last_line and stripped:
                repeat_count += 1
                if repeat_count >= 6:
                    continue
            else:
                repeat_count = 0
            cleaned.append(line)
            last_line = stripped

        original_lines = len(lines)
        cleaned_lines = len(cleaned)
        if original_lines - cleaned_lines > 5:
            print(f"[OCR] Repetition cleanup: {original_lines} -> {cleaned_lines} lines (removed {original_lines - cleaned_lines} repeated lines)")

        return '\n'.join(cleaned)

    async def _ocr_single_image(self, image_bytes: bytes, page_num: int = 0, total_pages: int = 0, timeout: float = 300.0) -> str:
        """Run OCR on a single prepared image bytes block.
        
        Uses model-specific parameters from get_model_params().
        If a repetition loop is detected, retries with anti-loop parameters.
        """
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        prompt_text = self._build_ocr_prompt(page_num, total_pages)
        model_params = self.get_model_params(self.model)
        
        # First attempt with standard parameters
        text = await self._run_ollama_ocr(image_b64, prompt_text, model_params, timeout)
        
        if not text:
            return None
        
        # Detect repetition loop: if >60% of raw output was removed
        cleaned = text["_cleaned"] if isinstance(text, dict) else text
        loop_ratio = text.get("_loop_ratio", 0) if isinstance(text, dict) else 0
        
        if loop_ratio > 0.6:
            print(f"[OCR] Loop detected ({loop_ratio:.0%} wasted). Retrying with anti-table prompt...")
            retry_params = {**model_params}
            retry_params["num_predict"] = min(model_params["num_predict"], 4096)
            
            anti_table_prompt = (
                "Transcribe ALL text in this image completely from top to bottom. "
                "Do NOT use table formatting, pipes |, or dashes ---. "
                "Write each piece of information on its own line, using colons for labels. "
                "Include every single line of text: headers, items, prices, totals, footer, company details, IBAN."
            )
            
            retry_text = await self._run_ollama_ocr(image_b64, anti_table_prompt, retry_params, timeout)
            if retry_text:
                retry_cleaned = retry_text["_cleaned"] if isinstance(retry_text, dict) else retry_text
                retry_ratio = retry_text.get("_loop_ratio", 0) if isinstance(retry_text, dict) else 0
                
                if len(retry_cleaned) > len(cleaned):
                    print(f"[OCR] Anti-table retry improved: {len(cleaned)} -> {len(retry_cleaned)} chars (loop: {retry_ratio:.0%})")
                    return retry_cleaned
                else:
                    print(f"[OCR] Retry not better ({len(retry_cleaned)} vs {len(cleaned)} chars), keeping original")
        
        return cleaned
    
    async def _run_ollama_ocr(self, image_b64: str, prompt_text: str, model_params: dict, timeout: float) -> dict | str | None:
        """Execute a single Ollama OCR request. Returns dict with _cleaned, _raw, _loop_ratio."""
        name_lower = (self.model or "").lower()
        use_think_param = "qwen3" in name_lower
        
        print(f"[OCR][DEBUG] Model: {self.model}, repeat_pen={model_params['repeat_penalty']}, predict={model_params['num_predict']}")
        
        attempts = len(self.ollama_urls)
        last_error = None
        
        for _ in range(attempts):
            url = self.get_current_url()
            try:
                system_msg = (
                    "You are an OCR module. Output ONLY the transcribed text from the image, nothing else. "
                    "No descriptions, no commentary, no 'Let me...' or explanations. Include all text: names, dates, IBANs, numbers, checkboxes as shown. "
                    "Raw transcription only."
                )

                request_body = {
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": prompt_text, "images": [image_b64]}
                    ],
                    "stream": False,
                    "keep_alive": "30m",
                    "options": {
                        "temperature": model_params["temperature"],
                        "repeat_penalty": model_params["repeat_penalty"],
                        "num_ctx": model_params["num_ctx"],
                        "num_predict": model_params["num_predict"]
                    }
                }
                if use_think_param:
                    request_body["think"] = False

                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(f"{url}/api/chat", json=request_body)
                    
                    if response.status_code != 200:
                        error_body = response.text[:500]
                        raise RuntimeError(f"Ollama error {response.status_code}: {error_body}")
                    
                    result = response.json()
                    message = result.get("message", {})
                    text_content = message.get("content", "").strip()
                    
                    text_content = self._strip_reasoning(text_content)
                    text_content = self._strip_ocr_commentary(text_content)
                    
                    thinking_text = message.get("thinking", "")
                    if not text_content and thinking_text:
                        print(f"[OCR] Content empty but thinking has {len(thinking_text)} chars, using as content")
                        text_content = self._strip_reasoning(thinking_text)
                    
                    raw_len = len(text_content) if text_content else 0
                    
                    if text_content:
                        text_content = self._clean_repetitions(text_content)
                    
                    cleaned_len = len(text_content) if text_content else 0
                    loop_ratio = 1 - (cleaned_len / raw_len) if raw_len > 0 else 0
                    
                    if raw_len != cleaned_len:
                        print(f"[OCR] Repetition cleanup: {raw_len} -> {cleaned_len} chars ({loop_ratio:.0%} removed)")
                    
                    eval_count = result.get("eval_count", 0)
                    if eval_count >= 8000:
                        print(f"[OCR] WARNING: Token limit likely hit ({eval_count} tokens)")
                    
                    if not text_content:
                        print(f"[OCR DEBUG] No text extracted. Keys: {list(message.keys())}")
                        try:
                            with open("/app/data/failed_ocr_debug.png", "wb") as f:
                                import base64 as b64mod
                                f.write(b64mod.b64decode(image_b64))
                        except Exception:
                            pass
                        return None
                    
                    src = "thinking-fallback" if (not message.get("content", "").strip() and thinking_text) else "content"
                    print(f"[OCR] Success: {cleaned_len} chars, {eval_count} tokens from {src}")
                    
                    return {"_cleaned": text_content, "_raw_len": raw_len, "_loop_ratio": loop_ratio}
                    
            except Exception as e:
                logger.warning(f"OCR failed at {url}: {e}")
                print(f"[OCR] Connection failed to {url}. Trying next server...")
                last_error = e
                self.rotate_url()
                
        raise RuntimeError(f"All Ollama servers ({attempts}) failed. Last error: {last_error}")

    def save_stats(self, doc_id: int, duration: float, pages: int, chars: int, success: bool = True):
        """Save OCR statistics to JSON file. Only call AFTER document was actually updated."""
        import json
        from datetime import datetime
        from pathlib import Path
        
        stats_file = Path("/app/data/ocr_stats.json")
        entry = {
            "timestamp": datetime.now().isoformat(),
            "doc_id": doc_id,
            "duration": round(duration, 2),
            "pages": pages,
            "chars": chars,
            "model": self.model,
            "server": self.get_current_url(),
            "success": success
        }
        
        try:
            stats = []
            if stats_file.exists():
                with open(stats_file, "r") as f:
                    try:
                        stats = json.load(f)
                    except:
                        pass
            
            stats.append(entry)
            # Keep last 1000 entries
            stats = stats[-1000:]
            
            with open(stats_file, "w") as f:
                json.dump(stats, f)
        except Exception as e:
            logger.error(f"Failed to save stats: {e}")

    def get_stats(self) -> List[Dict[str, Any]]:
        """Get OCR statistics."""
        import json
        from pathlib import Path
        stats_file = Path("/app/data/ocr_stats.json")
        if stats_file.exists():
            try:
                with open(stats_file, "r") as f:
                    return json.load(f)
            except:
                pass
        return []

    
    def _extract_text_from_pdf(self, file_bytes: bytes) -> Optional[str]:
        """Extract text from PDF bytes using pypdf.
        
        Refined Logic (v1.1.7):
        - If text is found, we check metadata.
        - If metadata indicates previous OCR (Abbyy, Tesseract, Paperless), we IGNORE the text 
          and return None (force new Vision OCR), because the user wants to improve it.
        - If metadata indicates 'Digital Born' (Word, LaTeX, Invoice Systems), we RETURN the text (Skip OCR).
        """
        # If Smart-Skip is disabled via settings, always return None to force OCR
        if not self.smart_skip_enabled:
            logger.info("Smart-Skip disabled in settings. Forcing OCR.")
            return None

        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            
            # 1. Check Metadata for "Bad" OCR sources
            meta = reader.metadata or {}
            creator = (meta.get("/Creator", "") or "").lower()
            producer = (meta.get("/Producer", "") or "").lower()
            
            ocr_keywords = ["abbyy", "finereader", "tesseract", "paperless", "ocr", "scan"]
            if any(k in creator for k in ocr_keywords) or any(k in producer for k in ocr_keywords):
                logger.info(f"Detected previous OCR tool in metadata ({creator} / {producer}). Forcing new OCR.")
                return None
            
            # 2. Extract Text (if not blacklisted)
            text = ""
            # Limit to first 5 pages for detection speed
            for i, page in enumerate(reader.pages):
                if i > 5: break 
                text += page.extract_text() + "\n\n"
            
            return text.strip()
        except Exception as e:
            logger.warning(f"Native PDF text extraction failed: {e}")
            return None

    async def ocr_document(self, paperless_client, document_id: int, force: bool = False) -> Dict[str, Any]:
        """OCR a document (all pages). Download original file, convert pages to images, OCR each."""
        start_time = time.time()
        print(f"[OCR] Starting OCR for document {document_id}")
        
        # Get document metadata
        doc = await paperless_client.get_document(document_id)
        if not doc:
            raise ValueError(f"Dokument {document_id} nicht gefunden")
        
        old_content = doc.get("content", "") or ""
        title = doc.get("title", f"Dokument {document_id}")
        
        # Download original file
        try:
            file_bytes = await paperless_client.download_document_file(document_id)
            logger.info(f"Downloaded document {document_id}: {len(file_bytes)} bytes")
            print(f"[OCR] Downloaded {len(file_bytes)} bytes")
        except Exception as e:
            raise ValueError(f"Download fehlgeschlagen: {e}")

        # OPTIMIZATION: Check for native text first (skip OCR if present)
        # Unless force=True is passed
        if not force:
            native_text = self._extract_text_from_pdf(file_bytes)
            if native_text and len(native_text) > 50:
                logger.info(f"Found native text in PDF ({len(native_text)} chars). Skipping OCR.")
                print(f"[OCR] Native text found ({len(native_text)} chars). Skipping vision OCR.")
                
                duration = time.time() - start_time
                return {
                    "document_id": document_id,
                    "title": title,
                    "old_content": old_content,
                    "new_content": native_text,
                    "old_length": len(old_content),
                    "new_length": len(native_text),
                    "ocr_duration": duration,
                    "ocr_pages": 0,
                    "source": "native_pdf"
                }

        # Convert to images with model-appropriate DPI
        images = []
        model_params = self.get_model_params(self.model)
        render_dpi = model_params.get("render_dpi", 200)
        try:
            # Try parsing as PDF first - run in thread pool to not block loop
            loop = asyncio.get_running_loop()
            images = await loop.run_in_executor(
                None,
                lambda: convert_from_bytes(file_bytes, dpi=render_dpi)
            )
            msg = f"Converted PDF to {len(images)} pages at {render_dpi} DPI"
            logger.info(msg)
            print(f"[OCR] {msg}")
        except Exception as e:
            # Not a PDF or failed, try loading as single image
            print(f"[OCR] PDF conversion failed/not a PDF: {e}")
            try:
                img = Image.open(io.BytesIO(file_bytes))
                images = [img]
                msg = "Loaded as single image"
                logger.info(msg)
                print(f"[OCR] {msg}")
            except Exception as e:
                raise ValueError(f"Dateiformat nicht unterstützt oder Fehler: {e}")

        if not images:
            raise ValueError("Keine Seiten aus dem Dokument extrahiert")

        # Process all pages
        full_text_parts = []
        
        for i, img in enumerate(images):
            try:
                msg = f"Processing page {i+1}/{len(images)}"
                logger.info(msg)
                print(f"[OCR] {msg}")
                # Use model-optimal image size
                model_params = self.get_model_params(self.model)
                optimal_size = max(self.max_image_size, model_params["max_image_size"])
                prepared_bytes = self._prepare_image_for_ollama(img, max_size=optimal_size)
                page_text = await self._ocr_single_image(prepared_bytes, page_num=i+1, total_pages=len(images))
                
                if not page_text or not page_text.strip():
                     raise ValueError("Empty result from OCR model")
                     
                full_text_parts.append(page_text)
            except Exception as e:
                # STRICT MODE: If ONE page fails, the whole document fails.
                # We do not want partial documents in Paperless.
                error_msg = f"Error on page {i+1}: {e}"
                logger.error(error_msg)
                print(f"[OCR] {error_msg}")
                raise ValueError(f"Multi-page consistency check failed: {error_msg}")

        if len(full_text_parts) != len(images):
             raise ValueError(f"Page count mismatch: Expected {len(images)}, got {len(full_text_parts)}")

        new_content = "\n\n".join(full_text_parts)
        
        duration = time.time() - start_time
        
        return {
            "document_id": document_id,
            "title": title,
            "old_content": old_content,
            "ocr_duration": duration,
            "ocr_pages": len(images),
            "new_content": new_content,
            "old_length": len(old_content),
            "new_length": len(new_content)
        }

    # Batch method uses ocr_document internally implicitly by calling ocr_image logic
    # But wait, batch_ocr calls ocr_image directly. We should update batch_ocr too to use ocr_document logic or reuse methods.
    # To keep it simple in this aggressive refactor, I will reuse the helper methods.
    
    async def ocr_image(self, image_bytes: bytes) -> str:
        """Legacy method for backward compat or single image bytes."""
        # Convert bytes to PIL Image first
        try:
            img = Image.open(io.BytesIO(image_bytes))
            prepared = self._prepare_image_for_ollama(img)
            return await self._ocr_single_image(prepared)
        except Exception as e:
            logger.error(f"Legacy ocr_image failed: {e}")
            raise
    
    async def apply_ocr_result(
        self, 
        paperless_client, 
        document_id: int, 
        new_content: str,
        set_finish_tag: bool = True
    ) -> Dict[str, Any]:
        """Apply OCR result to document and optionally set ocrfinish tag.
        
        Optimized v2 (inspired by paperless-gpt's approach):
        - Content PATCH is sent with ONLY content (no tags) for faster re-indexing
        - Tag is added separately via lightweight bulk_edit API (no re-index)
        - get_document() call eliminated (was only needed to get tag list)
        """
        start_time = time.time()
        
        # Step 1: PATCH only content -- this triggers Paperless re-indexing
        await paperless_client.update_document(document_id, {"content": new_content})
        
        # Step 2: Add ocrfinish tag via bulk_edit with retry
        tag_success = True
        if set_finish_tag:
            tag = await paperless_client.get_or_create_tag(TAG_OCR_FINISH)
            tag_id = tag.get("id")
            if tag_id:
                for attempt in range(2):
                    try:
                        await paperless_client.bulk_update_documents(
                            document_ids=[document_id],
                            add_tags=[tag_id]
                        )
                        break
                    except Exception as e:
                        if attempt == 0:
                            logger.warning(f"Tag update for doc {document_id} failed, retrying: {e}")
                            await asyncio.sleep(2)
                        else:
                            tag_success = False
                            logger.error(f"Tag update for doc {document_id} failed after retry: {e}")
        
        # Save stats AFTER content + tag
        duration = time.time() - start_time
        try:
            self.save_stats(document_id, duration, 0, len(new_content), success=tag_success)
        except:
            pass
        
        return {"success": tag_success, "document_id": document_id}
    
    async def batch_ocr(
        self,
        paperless_client,
        mode: str = "all",
        document_ids: List[int] = None,
        set_finish_tag: bool = True,
        remove_runocr_tag: bool = True
    ) -> None:
        """Run batch OCR. Updates batch_state in-place for progress tracking."""
        global batch_state
        
        batch_state.update({
            "running": True,
            "should_stop": False,
            "total": 0,
            "processed": 0,
            "current_document": None,
            "errors": [],
            "log": [],
            "mode": mode
        })
        
        try:
            # Get the tags we need
            ocrfinish_tag = await paperless_client.get_or_create_tag(TAG_OCR_FINISH)
            ocrfinish_tag_id = ocrfinish_tag.get("id")
            
            runocr_tag = None
            runocr_tag_id = None
            if mode == "tagged" or remove_runocr_tag:
                runocr_tag = await paperless_client.get_or_create_tag(TAG_RUN_OCR)
                runocr_tag_id = runocr_tag.get("id")
            
            # Determine which documents to process
            documents = []
            
            # OPTIMIZATION: Check for best server before starting
            batch_state["log"].append("🔎 Prüfe verfügbare Ollama-Server...")
            if await self.find_best_server():
                batch_state["log"].append(f"🚀 Verbunden mit: {self.get_current_url()}")
            else:
                 batch_state["log"].append(f"⚠️ Warnung: Kein Server antwortet schnell. Nutze {self.get_current_url()}")

            if mode == "all":
                # Get all documents
                all_docs = await paperless_client.get_documents()
                # Filter out those already having ocrfinish tag
                documents = [
                    d for d in all_docs 
                    if ocrfinish_tag_id not in d.get("tags", [])
                ]
                batch_state["log"].append(
                    f"📋 Modus: Alle Dokumente ({len(documents)} ohne ocrfinish Tag)"
                )
                
            elif mode == "tagged":
                # Get documents with runocr tag
                if runocr_tag_id:
                    documents = await paperless_client.get_documents(tag_id=runocr_tag_id)
                    # Also filter out those with ocrfinish tag
                    documents = [
                        d for d in documents
                        if ocrfinish_tag_id not in d.get("tags", [])
                    ]
                batch_state["log"].append(
                    f"🏷️ Modus: Nur mit Tag 'runocr' ({len(documents)} Dokumente)"
                )
                
            elif mode == "manual" and document_ids:
                for doc_id in document_ids:
                    try:
                        doc = await paperless_client.get_document(doc_id)
                        if doc and ocrfinish_tag_id not in doc.get("tags", []):
                            documents.append(doc)
                    except Exception:
                        batch_state["errors"].append(f"Dokument {doc_id} nicht gefunden")
                batch_state["log"].append(
                    f"✏️ Modus: Manuell ({len(documents)} Dokumente)"
                )
            
            # Filter out ignored documents
            ignored_ids = get_ocr_ignored_ids()
            if ignored_ids:
                before_count = len(documents)
                documents = [d for d in documents if d.get("id") not in ignored_ids]
                skipped = before_count - len(documents)
                if skipped > 0:
                    batch_state["log"].append(f"🚫 {skipped} Dokument(e) übersprungen (OCR Ignore-Liste)")
                    print(f"[OCR] Skipped {skipped} ignored documents")
            
            batch_state["total"] = len(documents)
            
            if not documents:
                batch_state["log"].append("⚠️ Keine Dokumente zum Verarbeiten gefunden.")
                return
            
            # Process each document
            for i, doc in enumerate(documents):
                if batch_state["should_stop"]:
                    batch_state["log"].append("🛑 Batch-OCR wurde gestoppt.")
                    break
                
                # Check for pause
                if batch_state["paused"]:
                    batch_state["log"].append("⏸️ Batch-OCR pausiert...")
                    while batch_state["paused"]:
                        if batch_state["should_stop"]:
                            break
                        await asyncio.sleep(1)
                    if not batch_state["should_stop"]:
                        batch_state["log"].append("▶️ Batch-OCR fortgesetzt.")
                
                if batch_state["should_stop"]:
                    break
                
                doc_id = doc.get("id")
                doc_title = doc.get("title", f"Dokument {doc_id}")
                batch_state["current_document"] = {"id": doc_id, "title": doc_title}
                batch_state["log"].append(f"🔄 [{i+1}/{len(documents)}] Verarbeite: {doc_title} (ID: {doc_id})")
                
                try:
                    # Use the multi-page aware OCR logic
                    ocr_result = await self.ocr_document(paperless_client, doc_id)
                    new_content = ocr_result.get("new_content")
                    old_content = ocr_result.get("old_content", "")
                    ocr_duration = ocr_result.get("ocr_duration", 0)
                    ocr_pages = ocr_result.get("ocr_pages", 1)
                    old_len = len(old_content) if old_content else 0
                    new_len = len(new_content) if new_content else 0
                    
                    if new_content:
                        # Quality check: if new text is significantly shorter, flag for review
                        needs_review = False
                        if old_len > 100 and new_len < old_len * QUALITY_THRESHOLD:
                            ratio = round(new_len / old_len * 100) if old_len > 0 else 0
                            batch_state["log"].append(
                                f"🔁 {doc_title}: Qualitätscheck fehlgeschlagen ({ratio}% des Originals) → Automatischer Retry..."
                            )
                            print(f"[OCR] Quality check failed for {doc_id} ({ratio}%), retrying OCR...")
                            
                            # Wait briefly before retry to let Ollama stabilize
                            await asyncio.sleep(3)
                            
                            # RETRY: Run OCR again on the same document
                            try:
                                retry_result = await self.ocr_document(paperless_client, doc_id)
                                retry_content = retry_result.get("new_content")
                                retry_len = len(retry_content) if retry_content else 0
                                
                                if retry_content and retry_len > new_len:
                                    new_content = retry_content
                                    new_len = retry_len
                                    ocr_duration += retry_result.get("ocr_duration", 0)
                                    batch_state["log"].append(
                                        f"🔁 {doc_title}: Retry lieferte besseres Ergebnis ({retry_len} vs {new_len - (retry_len - new_len)} Zeichen)"
                                    )
                                    print(f"[OCR] Retry improved: {retry_len} chars (was {new_len - (retry_len - new_len)})")
                                elif retry_content:
                                    if retry_len >= new_len:
                                        new_content = retry_content
                                        new_len = retry_len
                                    ocr_duration += retry_result.get("ocr_duration", 0)
                                    batch_state["log"].append(
                                        f"🔁 {doc_title}: Retry ähnliches Ergebnis ({retry_len} Zeichen)"
                                    )
                                    print(f"[OCR] Retry similar: {retry_len} chars")
                            except Exception as retry_err:
                                batch_state["log"].append(
                                    f"🔁 {doc_title}: Retry fehlgeschlagen - {str(retry_err)}"
                                )
                                print(f"[OCR] Retry failed for {doc_id}: {retry_err}")
                            
                            # Re-check quality after retry
                            new_len = len(new_content) if new_content else 0
                            if old_len > 100 and new_len < old_len * QUALITY_THRESHOLD:
                                needs_review = True
                                ratio = round(new_len / old_len * 100) if old_len > 0 else 0
                                batch_state["log"].append(
                                    f"⚠️ {doc_title}: Auch nach Retry nur {ratio}% des Originals "
                                    f"({new_len} vs {old_len} Zeichen) → In Prüfliste"
                                )
                                queue = load_review_queue()
                                queue.append({
                                    "document_id": doc_id,
                                    "title": doc_title,
                                    "old_content": old_content,
                                    "new_content": new_content,
                                    "old_length": old_len,
                                    "new_length": new_len,
                                    "ratio": ratio,
                                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                    "retried": True
                                })
                                save_review_queue(queue)
                            else:
                                batch_state["log"].append(
                                    f"✅ {doc_title}: Retry erfolgreich! Qualität jetzt OK ({new_len} Zeichen)"
                                )
                                print(f"[OCR] Retry fixed quality for {doc_id}: {new_len} chars now passes threshold")
                        
                        if not needs_review:
                            # Step 1: PATCH content to Paperless
                            await paperless_client.update_document(doc_id, {"content": new_content})
                            
                            # Step 2: Tag changes via bulk_edit (with retry)
                            add_tags = []
                            remove_tags = []
                            tag_success = True
                            
                            if set_finish_tag and ocrfinish_tag_id:
                                add_tags.append(ocrfinish_tag_id)
                            if remove_runocr_tag and runocr_tag_id:
                                remove_tags.append(runocr_tag_id)
                            
                            if add_tags or remove_tags:
                                for attempt in range(2):
                                    try:
                                        await paperless_client.bulk_update_documents(
                                            document_ids=[doc_id],
                                            add_tags=add_tags if add_tags else None,
                                            remove_tags=remove_tags if remove_tags else None
                                        )
                                        tag_success = True
                                        break
                                    except Exception as e:
                                        tag_success = False
                                        if attempt == 0:
                                            logger.warning(f"Tag update for doc {doc_id} failed, retrying: {e}")
                                            await asyncio.sleep(2)
                                        else:
                                            logger.error(f"Tag update for doc {doc_id} failed after retry: {e}")
                                            batch_state["log"].append(f"⚠️ {doc_title}: Tag-Update 2x fehlgeschlagen: {e}")
                            
                            # Stats ONLY after content + tag were both handled
                            try:
                                self.save_stats(doc_id, ocr_duration, ocr_pages, new_len, success=tag_success)
                            except:
                                pass
                            
                            if not tag_success:
                                batch_state["log"].append(f"⚠️ {doc_title}: Content OK, aber ocrfinish-Tag fehlt! ({new_len} Zeichen)")
                            else:
                                batch_state["log"].append(f"✅ {doc_title}: OCR erfolgreich ({new_len} Zeichen)")
                    else:
                        batch_state["log"].append(f"⚠️ {doc_title}: Kein Text erkannt")
                        batch_state["errors"].append(f"{doc_title}: Kein Text erkannt")
                    
                except Exception as e:
                    # Save failed stats so we can track failures
                    try:
                        self.save_stats(doc_id, 0, 0, 0, success=False)
                    except:
                        pass
                    error_msg = f"❌ {doc_title}: Fehler - {str(e)}"
                    batch_state["log"].append(error_msg)
                    batch_state["errors"].append(error_msg)
                    logger.error(f"OCR error for document {doc_id}: {e}")
                
                batch_state["processed"] = i + 1
                
                # Small delay between documents to not overload Ollama
                await asyncio.sleep(5)
            
            batch_state["log"].append(
                f"🏁 Fertig! {batch_state['processed']}/{batch_state['total']} Dokumente verarbeitet, "
                f"{len(batch_state['errors'])} Fehler."
            )
            
        except Exception as e:
            batch_state["log"].append(f"💥 Kritischer Fehler: {str(e)}")
            logger.error(f"Batch OCR critical error: {e}")
        finally:
            batch_state["running"] = False
            batch_state["current_document"] = None

    async def watchdog_loop(self, paperless_client):
        """Continuous background loop to check for new documents."""
        # Note: Imports are inside to avoid circular deps if any, but standard lib is fine.
        import asyncio
        from datetime import datetime
        
        logger.info("Watchdog started")
        print("[OCR] Watchdog started")
        
        while watchdog_state["enabled"]:
            try:
                watchdog_state["running"] = True
                
                if batch_state["running"] or single_ocr_running:
                    reason = "Batch" if batch_state["running"] else "Single-OCR"
                    logger.info(f"Watchdog: {reason} already running, skipping this cycle")
                else:
                    logger.info("Watchdog checking for new documents...")
                    print(f"[OCR] Watchdog check at {datetime.now().isoformat()}")
                    
                    # Run batch in "all" mode
                    # This will update batch_state and UI will see it running.
                    await self.batch_ocr(
                        paperless_client, 
                        mode="all", 
                        set_finish_tag=True, 
                        remove_runocr_tag=True
                    )
                    
                watchdog_state["last_run"] = datetime.now().isoformat()
                
            except Exception as e:
                logger.error(f"Watchdog error: {e}")
                print(f"[OCR] Watchdog error: {e}")
            
            # Wait for interval
            interval_min = watchdog_state.get("interval_minutes", 1)
            # Check every second to allow faster stopping
            for _ in range(interval_min * 60):
                if not watchdog_state["enabled"]:
                    break
                await asyncio.sleep(1)
        
        watchdog_state["running"] = False
        logger.info("Watchdog stopped")
        print("[OCR] Watchdog stopped")
