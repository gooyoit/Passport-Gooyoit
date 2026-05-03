"""Redis client helpers."""

import threading

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import settings

_redis_client: Redis | None = None
_redis_lock = threading.Lock()


def get_redis_client() -> Redis | None:
    global _redis_client
    with _redis_lock:
        if _redis_client is not None:
            try:
                return _redis_client
            except RedisError:
                _redis_client = None
        try:
            _redis_client = Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                retry_on_timeout=True,
                health_check_interval=30,
                max_connections=50,
                socket_timeout=2,
                socket_connect_timeout=2,
            )
            return _redis_client
        except RedisError:
            return None
