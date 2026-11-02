"""Redis-based rate limiting."""

import ipaddress

from fastapi import Request
from redis import Redis

from app.core.config import settings


class RateLimitExceeded(Exception):
    def __init__(self, detail: str, retry_after: int):
        self.detail = detail
        self.retry_after = retry_after


TRUSTED_PROXIES = {"127.0.0.1", "::1"}


def _is_trusted(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str.strip())
        for trusted in TRUSTED_PROXIES:
            if "/" in trusted:
                if addr in ipaddress.ip_network(trusted, strict=False):
                    return True
            elif addr == ipaddress.ip_address(trusted):
                return True
    except ValueError:
        pass
    return False


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        for ip in reversed(forwarded.split(",")):
            ip = ip.strip()
            if ip and not _is_trusted(ip):
                return ip
    return request.client.host if request.client else "unknown"


def record_failed_login(redis_client: Redis | None, email: str, ip: str) -> None:
    if redis_client is None:
        return
    key = f"rl:lock:{email}:{ip}"
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, settings.rate_limit_lockout_seconds)


def check_login_lockout(redis_client: Redis | None, email: str, ip: str) -> None:
    if redis_client is None:
        return
    key = f"rl:lock:{email}:{ip}"
    count = redis_client.get(key)
    if count and int(count) >= settings.rate_limit_failed_attempts:
        raise RateLimitExceeded("Account temporarily locked", redis_client.ttl(key))


def check_sms_rate_limit(redis_client: Redis | None, phone: str, ip: str) -> None:
    """Industry-standard SMS throttling: per-phone minute/hour/day and per-IP hour/day."""
    if redis_client is None:
        return

    def _window(key: str, seconds: int, limit: int) -> None:
        count = redis_client.incr(key)
        if count == 1:
            redis_client.expire(key, seconds)
        if count > limit:
            raise RateLimitExceeded("SMS rate limit exceeded", redis_client.ttl(key))

    _window(f"rl:sms:phone:m:{phone}", 60, settings.sms_rate_phone_per_minute)
    _window(f"rl:sms:phone:h:{phone}", 3600, settings.sms_rate_phone_per_hour)
    _window(f"rl:sms:phone:d:{phone}", 86400, settings.sms_rate_phone_per_day)
    _window(f"rl:sms:ip:h:{ip}", 3600, settings.sms_rate_ip_per_hour)
    _window(f"rl:sms:ip:d:{ip}", 86400, settings.sms_rate_ip_per_day)


def check_registration_rate_limit(redis_client: Redis | None, ip: str) -> None:
    if redis_client is None:
        return
    key = f"rate_limit:register:{ip}"
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, 3600)
    if count > 5:
        raise RateLimitExceeded("Registration rate limit exceeded", redis_client.ttl(key))


def clear_failed_login(redis_client: Redis | None, email: str, ip: str) -> None:
    if redis_client is None:
        return
    redis_client.delete(f"rl:lock:{email}:{ip}")
