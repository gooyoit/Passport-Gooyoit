"""SMS delivery through Aliyun Dysms (verification codes only)."""

import json
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

SMS_PURPOSES = ("login", "register", "reset_password")


def _template_for(purpose: str) -> str:
    if purpose == "register":
        return settings.aliyun_sms_template_register
    if purpose == "reset_password":
        return settings.aliyun_sms_template_reset_password
    return settings.aliyun_sms_template_login


def sms_enabled() -> bool:
    return settings.sms_provider == "aliyun" and bool(
        settings.aliyun_sms_access_key_id
        and settings.aliyun_sms_access_key_secret
        and settings.aliyun_sms_sign_name
    )


def send_sms_code(phone: str, code: str, purpose: str = "login") -> bool:
    """Send a verification code; returns False when SMS is not configured."""
    if not sms_enabled():
        logger.warning("sms_not_configured", phone=phone)
        return False
    template_code = _template_for(purpose)
    if not template_code:
        logger.error("sms_template_missing", phone=phone, purpose=purpose)
        return False
    # Imported lazily so the SDK is only required when SMS is enabled.
    from alibabacloud_dysmsapi20170525.client import Client
    from alibabacloud_dysmsapi20170525.models import SendSmsRequest
    from alibabacloud_tea_openapi.models import Config

    client = Client(
        Config(
            access_key_id=settings.aliyun_sms_access_key_id,
            access_key_secret=settings.aliyun_sms_access_key_secret,
            endpoint=settings.aliyun_sms_endpoint,
        )
    )
    try:
        response = client.send_sms(
            SendSmsRequest(
                phone_numbers=phone,
                sign_name=settings.aliyun_sms_sign_name,
                template_code=template_code,
                template_param=json.dumps({"code": code}),
            )
        )
    except Exception as exc:
        logger.error("sms_send_failed", phone=phone, error=str(exc))
        return False
    ok = response.body is not None and response.body.code == "OK"
    if not ok:
        logger.error(
            "sms_send_rejected",
            phone=phone,
            code=getattr(response.body, "code", None),
            message=getattr(response.body, "message", None),
        )
    return ok
