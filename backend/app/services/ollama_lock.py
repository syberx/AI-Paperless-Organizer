"""Central Ollama lock to prevent OCR and Classification from competing for the GPU."""

import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

_lock = asyncio.Lock()

_holder: Optional[str] = None
_holder_since: Optional[float] = None


async def acquire(owner: str, timeout: float = 600) -> bool:
    """Try to acquire the Ollama lock. Returns True if acquired within timeout."""
    start = time.monotonic()
    while True:
        if _lock.locked():
            elapsed = time.monotonic() - start
            if elapsed > timeout:
                logger.warning(f"[OllamaLock] {owner} timed out waiting for lock (held by {_holder})")
                return False
            if int(elapsed) % 30 == 0 and elapsed > 1:
                logger.info(f"[OllamaLock] {owner} waiting... (held by {_holder} for {int(time.monotonic() - (_holder_since or start))}s)")
            await asyncio.sleep(2)
        else:
            try:
                await asyncio.wait_for(_lock.acquire(), timeout=5)
                _set_holder(owner)
                logger.info(f"[OllamaLock] Acquired by {owner}")
                return True
            except asyncio.TimeoutError:
                continue


def release(owner: str):
    """Release the Ollama lock."""
    global _holder, _holder_since
    if _lock.locked():
        try:
            _lock.release()
        except RuntimeError:
            pass
    logger.info(f"[OllamaLock] Released by {owner}")
    _holder = None
    _holder_since = None


def is_locked() -> bool:
    return _lock.locked()


def current_holder() -> Optional[str]:
    return _holder


def _set_holder(name: str):
    global _holder, _holder_since
    _holder = name
    _holder_since = time.monotonic()
