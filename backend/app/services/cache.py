"""Simple in-memory cache for API responses."""

import asyncio
from datetime import datetime, timedelta
from typing import Any, Dict, Optional
import hashlib
import json


class CacheEntry:
    """A single cache entry with expiration."""
    
    def __init__(self, value: Any, ttl_seconds: int = 60):
        self.value = value
        self.expires_at = datetime.now() + timedelta(seconds=ttl_seconds)
    
    def is_expired(self) -> bool:
        return datetime.now() > self.expires_at


class SimpleCache:
    """Simple in-memory cache with TTL support."""
    
    def __init__(self):
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = asyncio.Lock()
    
    async def get(self, key: str) -> Optional[Any]:
        """Get a value from cache."""
        async with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            if entry.is_expired():
                del self._cache[key]
                return None
            return entry.value
    
    async def set(self, key: str, value: Any, ttl_seconds: int = 60) -> None:
        """Set a value in cache."""
        async with self._lock:
            self._cache[key] = CacheEntry(value, ttl_seconds)
    
    async def delete(self, key: str) -> None:
        """Delete a value from cache."""
        async with self._lock:
            if key in self._cache:
                del self._cache[key]
    
    async def clear(self, prefix: str = None) -> None:
        """Clear all cache or entries with a specific prefix."""
        async with self._lock:
            if prefix:
                keys_to_delete = [k for k in self._cache.keys() if k.startswith(prefix)]
                for key in keys_to_delete:
                    del self._cache[key]
            else:
                self._cache.clear()
    
    async def invalidate_paperless(self) -> None:
        """Invalidate all Paperless-related cache entries."""
        await self.clear("paperless:")
    
    def make_key(self, *args) -> str:
        """Create a cache key from arguments."""
        key_str = ":".join(str(a) for a in args)
        return hashlib.md5(key_str.encode()).hexdigest()


# Global cache instance
cache = SimpleCache()


def get_cache() -> SimpleCache:
    """Get the global cache instance."""
    return cache

