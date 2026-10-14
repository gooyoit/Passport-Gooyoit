"""Minimal TTL + LRU cache for access_token -> userinfo."""

import threading
import time
from collections import OrderedDict
from typing import Any


class TTLCache:
    """Tiny in-process cache: entries expire after ``ttl`` seconds.

    Thread-safe: FastAPI dependencies run in a threadpool, so get/set may
    be called concurrently.
    """

    def __init__(self, ttl: float, maxsize: int = 1024) -> None:
        self._ttl = ttl
        self._maxsize = maxsize
        self._data: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at < time.monotonic():
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = (time.monotonic() + self._ttl, value)
            self._data.move_to_end(key)
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)
