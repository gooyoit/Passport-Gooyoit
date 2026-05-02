"""Email sending service via Resend."""

import resend

from app.core.config import settings

resend.api_key = settings.resend_api_key

SENDER = "Gooyoit <onboarding@resend.dev>"


def send_verification_code(to: str, code: str) -> None:
    resend.Emails.send({
        "from": SENDER,
        "to": to,
        "subject": f"Your verification code: {code}",
        "html": f"""
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
  <h2 style="margin: 0 0 8px; font-size: 20px;">Verification Code</h2>
  <p style="color: #6b7280; margin: 0 0 24px;">Use the following code to sign in:</p>
  <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827; text-align: center; padding: 20px 0;">{code}</div>
  <p style="color: #9ca3af; font-size: 13px; margin: 24px 0 0;">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
</div>
""",
    })
