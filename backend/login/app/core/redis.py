"""Redis client helpers."""

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import settings

_redis_client: Redis | None = None


def get_redis_client() -> Redis | None:
    global _redis_client
    if _redis_client is not None:
        try:
            _redis_client.ping()
            return _redis_client
        except RedisError:
            _redis_client = None
    try:
        _redis_client = Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            retry_on_timeout=True,
            health_check_interval=30,
        )
        _redis_client.ping()
        return _redis_client
    except RedisError:
        return None
