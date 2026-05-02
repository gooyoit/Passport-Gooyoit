"""Redis client helpers."""

from functools import lru_cache

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import settings


@lru_cache
def get_redis_client() -> Redis | None:
    """Return a Redis client if Redis is reachable."""
    try:
        client = Redis.from_url(settings.redis_url, decode_responses=True)
        client.ping()
        return client
    except RedisError:
        return None
