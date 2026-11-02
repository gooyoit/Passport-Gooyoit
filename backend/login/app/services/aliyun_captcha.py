"""Aliyun Captcha 2.0 server-side verification (VerifyIntelligentCaptcha)."""

import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)


def captcha_enabled() -> bool:
    return bool(
        settings.aliyun_captcha_scene_id
        and settings.aliyun_captcha_access_key_id
        and settings.aliyun_captcha_access_key_secret
    )


_client = None


def _get_client():
    """Build the SDK client once; per-call construction re-does DNS + TLS."""
    global _client
    if _client is None:
        from alibabacloud_captcha20230305.client import Client
        from alibabacloud_tea_openapi.models import Config

        _client = Client(
            Config(
                access_key_id=settings.aliyun_captcha_access_key_id,
                access_key_secret=settings.aliyun_captcha_access_key_secret,
                endpoint=settings.aliyun_captcha_endpoint,
                connect_timeout=5000,
                read_timeout=5000,
            )
        )
    return _client


def verify_captcha(captcha_verify_param: str) -> bool:
    """Verify the token produced by the frontend Aliyun Captcha 2.0 widget."""
    if not captcha_enabled():
        logger.warning("captcha_not_configured")
        return False
    # Imported lazily so the SDK is only required when captcha is enabled.
    from alibabacloud_captcha20230305 import models as captcha_models

    client = _get_client()
    try:
        response = client.verify_intelligent_captcha(
            captcha_models.VerifyIntelligentCaptchaRequest(
                scene_id=settings.aliyun_captcha_scene_id,
                captcha_verify_param=captcha_verify_param,
            )
        )
    except Exception as exc:
        logger.error("captcha_verify_error", error=str(exc))
        return False
    body = response.body
    ok = bool(body and body.success and body.result and body.result.verify_result)
    if not ok:
        logger.warning(
            "captcha_verify_rejected",
            code=getattr(body, "code", None),
            message=getattr(body, "message", None),
        )
    return ok
