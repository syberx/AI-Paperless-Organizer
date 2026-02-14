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

# Review queue file
REVIEW_QUEUE_FILE = Path("/app/data/ocr_review_queue.json")

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

# Watchdog state
watchdog_state = {
    "enabled": False,
    "running": False,
    "interval_minutes": 5,
    "last_run": None,
    "task": None  # asyncio.Task
}


class OcrService:
    """Service for OCR using Ollama Vision models."""
    
    def __init__(self, ollama_url: str = DEFAULT_OLLAMA_URL, model: str = DEFAULT_OCR_MODEL, ollama_urls: List[str] = None):
        if ollama_urls and len(ollama_urls) > 0:
            self.ollama_urls = [u.rstrip("/") for u in ollama_urls if u.strip()]
        else:
            self.ollama_urls = [ollama_url.rstrip("/")]
            
        self.current_url_index = 0
        self.model = model
    
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
        """Test connection to Ollama and check if the model is available."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Check Ollama is running
                url = self.get_current_url()
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
                    "requested_model": self.model
                }
        except Exception as e:
            return {"connected": False, "model_available": False, "error": str(e)}
    
    def _prepare_image_for_ollama(self, img: Image.Image, max_size: int = 2240) -> bytes:
        """Convert PIL Image to PNG bytes, resized and aligned for Ollama Vision.
        
        qwen2.5vl requires dimensions visible by 28.
        We resize to max 2240px (80*28) for high quality.
        """
        try:
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            
            w, h = img.size
            if max(w, h) > max_size:
                ratio = max_size / max(w, h)
                w = int(w * ratio)
                h = int(h * ratio)
            
            # Round dimensions to nearest multiple of 28 (patch size for qwen2.5vl)
            w = max(28, (w // 28) * 28)
            h = max(28, (h // 28) * 28)
            
            img = img.resize((w, h), Image.LANCZOS)
            
            output = io.BytesIO()
            img.save(output, format="PNG")
            return output.getvalue()
        except Exception as e:
            logger.error(f"Image preparation failed: {e}")
            raise ValueError(f"Bildvorbereitung fehlgeschlagen: {e}")

    async def _ocr_single_image(self, image_bytes: bytes) -> str:
        """Run OCR on a single prepared image bytes block. Retries with failover URLs."""
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        
        attempts = len(self.ollama_urls)
        last_error = None
        
        for _ in range(attempts):
            url = self.get_current_url()
            try:
                # Use slightly longer timeout for generation
                async with httpx.AsyncClient(timeout=300.0) as client:
                    response = await client.post(
                        f"{url}/api/generate",
                        json={
                            "model": self.model,
                            "prompt": (
                                "Extract ALL text from this document image. "
                                "Return ONLY the extracted text, preserving the original layout and structure. "
                                "Include all headers, body text, dates, numbers, stamps, signatures. "
                                "Do not add commentary. Just raw text."
                            ),
                            "images": [image_b64],
                            "stream": False,
                            "options": {"temperature": 0.1, "num_predict": 4096}
                        }
                    )
                    
                    if response.status_code != 200:
                        error_body = response.text[:500]
                        raise RuntimeError(f"Ollama error {response.status_code}: {error_body}")
                    
                    result = response.json()
                    return result.get("response", "").strip()
                    
            except Exception as e:
                logger.warning(f"OCR failed at {url}: {e}")
                print(f"[OCR] Connection failed to {url}. Trying next server...")
                last_error = e
                self.rotate_url()
                
        raise RuntimeError(f"All Ollama servers ({attempts}) failed. Last error: {last_error}")

    def save_stats(self, doc_id: int, duration: float, pages: int, chars: int):
        """Save OCR statistics to JSON file."""
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
            "server": self.get_current_url()
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

    async def ocr_document(self, paperless_client, document_id: int) -> Dict[str, Any]:
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

        # Convert to images
        images = []
        try:
            # Try parsing as PDF first - run in thread pool to not block loop
            loop = asyncio.get_running_loop()
            images = await loop.run_in_executor(None, convert_from_bytes, file_bytes)
            msg = f"Converted PDF to {len(images)} pages"
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
        errors = []
        for i, img in enumerate(images):
            try:
                msg = f"Processing page {i+1}/{len(images)}"
                logger.info(msg)
                print(f"[OCR] {msg}")
                prepared_bytes = self._prepare_image_for_ollama(img)
                page_text = await self._ocr_single_image(prepared_bytes)
                if page_text:
                    full_text_parts.append(page_text)
            except Exception as e:
                logger.error(f"Error processing page {i+1}: {e}")
                print(f"[OCR] Error processing page {i+1}: {e}")
                errors.append(f"Seite {i+1}: {e}")

        if not full_text_parts:
            # All pages failed
            error_details = "; ".join(errors) if errors else "Result empty"
            raise ValueError(f"OCR failed for all pages: {error_details}")

        new_content = "\n\n".join(full_text_parts)
        
        duration = time.time() - start_time
        try:
            self.save_stats(document_id, duration, len(images), len(new_content))
        except:
            pass
        
        return {
            "document_id": document_id,
            "title": title,
            "old_content": old_content,
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
        """Apply OCR result to document and optionally set ocrfinish tag."""
        # Update document content
        await paperless_client.update_document(document_id, {"content": new_content})
        
        if set_finish_tag:
            # Ensure ocrfinish tag exists
            tag = await paperless_client.get_or_create_tag(TAG_OCR_FINISH)
            tag_id = tag.get("id")
            if tag_id:
                await paperless_client.add_tag_to_document(document_id, tag_id)
        
        return {"success": True, "document_id": document_id}
    
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
                    old_len = len(old_content) if old_content else 0
                    new_len = len(new_content) if new_content else 0
                    
                    if new_content:
                        # Quality check: if new text is significantly shorter, flag for review
                        needs_review = False
                        if old_len > 100 and new_len < old_len * QUALITY_THRESHOLD:
                            needs_review = True
                            ratio = round(new_len / old_len * 100) if old_len > 0 else 0
                            batch_state["log"].append(
                                f"⚠️ {doc_title}: Qualitätsprüfung! Neuer Text nur {ratio}% des Originals "
                                f"({new_len} vs {old_len} Zeichen) → Manuell prüfen"
                            )
                            # Add to review queue
                            queue = load_review_queue()
                            queue.append({
                                "document_id": doc_id,
                                "title": doc_title,
                                "old_content": old_content,
                                "new_content": new_content,
                                "old_length": old_len,
                                "new_length": new_len,
                                "ratio": ratio,
                                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
                            })
                            save_review_queue(queue)
                        
                        if not needs_review:
                            # Apply the new content
                            await paperless_client.update_document(doc_id, {"content": new_content})
                            
                            # Set ocrfinish tag
                            if set_finish_tag and ocrfinish_tag_id:
                                await paperless_client.add_tag_to_document(doc_id, ocrfinish_tag_id)
                            
                            # Remove runocr tag if present
                            if remove_runocr_tag and runocr_tag_id:
                                doc_tags = doc.get("tags", [])
                                if runocr_tag_id in doc_tags:
                                    await paperless_client.remove_tag_from_document(doc_id, runocr_tag_id)
                            
                            batch_state["log"].append(f"✅ {doc_title}: OCR erfolgreich ({new_len} Zeichen)")
                    else:
                        batch_state["log"].append(f"⚠️ {doc_title}: Kein Text erkannt")
                        batch_state["errors"].append(f"{doc_title}: Kein Text erkannt")
                    
                except Exception as e:
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
                
                if batch_state["running"]:
                    logger.info("Watchdog: Batch already running, skipping this cycle")
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
            interval_min = watchdog_state.get("interval_minutes", 5)
            # Check every second to allow faster stopping
            for _ in range(interval_min * 60):
                if not watchdog_state["enabled"]:
                    break
                await asyncio.sleep(1)
        
        watchdog_state["running"] = False
        logger.info("Watchdog stopped")
        print("[OCR] Watchdog stopped")
