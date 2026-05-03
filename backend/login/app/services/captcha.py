"""Captcha generation and verification."""

import base64
import io
import secrets
import string
import time
import uuid

import captcha.image
from redis import Redis

from app.core.config import settings

CAPTCHA_CHARS = string.digits + "ABCDEFGHJKLMNPQRSTUVWXYZ"

_captcha_store: dict[str, tuple[str, float]] = {}


def generate_captcha(redis_client: Redis | None) -> dict:
    text = "".join(secrets.choice(CAPTCHA_CHARS) for _ in range(settings.captcha_length))
    img = captcha.image.ImageCaptcha()
    buf = io.BytesIO()
    img.write(text, buf)
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode()

    key = str(uuid.uuid4())
    if redis_client:
        redis_client.setex(f"captcha:{key}", settings.captcha_ttl_seconds, text.lower())
    else:
        _captcha_store[key] = (text.lower(), time.time() + settings.captcha_ttl_seconds)

    result: dict = {"captcha_key": key, "captcha_image": f"data:image/png;base64,{b64}"}
    if settings.debug:
        result["captcha_answer"] = text.lower()
    return result


def verify_captcha(redis_client: Redis | None, key: str, answer: str) -> bool:
    if redis_client:
        stored = redis_client.get(f"captcha:{key}")
        redis_client.delete(f"captcha:{key}")
        return stored is not None and stored == answer.strip().lower()

    entry = _captcha_store.pop(key, None)
    if entry is None:
        return False
    text, expires_at = entry
    if time.time() > expires_at:
        return False
    return text == answer.strip().lower()
