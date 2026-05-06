"""WebAuthn / Passkey authentication service.

Uses discoverable credentials (resident keys) so login and registration
are merged into a single flow — the browser handles credential creation
and selection transparently.
"""

import json
import uuid

import structlog
from fastapi import HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes, options_to_json_dict
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    PublicKeyCredentialDescriptor,
)

from app.core.config import settings
from app.core.redis import get_redis_client
from app.models import User, UserIdentity, WebAuthnCredential as WebAuthnCredentialModel
from app.services.applications import get_active_application_by_client_id, is_login_method_enabled, validate_redirect_uri
from app.services.auth import (
    _set_sso_cookie_if_enabled,
    create_authorization_code,
    ensure_application_user,
    get_or_create_email_user,
    utcnow,
)

logger = structlog.get_logger(__name__)

CHALLENGE_PREFIX = "webauthn_challenge:"
CHALLENGE_TTL = 300


def _generate_challenge_id() -> str:
    return uuid.uuid4().hex


def _store_challenge(challenge_id: str, data: dict) -> None:
    redis = get_redis_client()
    if redis:
        redis.setex(f"{CHALLENGE_PREFIX}{challenge_id}", CHALLENGE_TTL, json.dumps(data))


def _load_challenge(challenge_id: str) -> dict | None:
    redis = get_redis_client()
    if not redis:
        return None
    raw = redis.get(f"{CHALLENGE_PREFIX}{challenge_id}")
    if not raw:
        return None
    return json.loads(raw)


def _delete_challenge(challenge_id: str) -> None:
    redis = get_redis_client()
    if redis:
        redis.delete(f"{CHALLENGE_PREFIX}{challenge_id}")


def begin_authentication(db: Session, client_id: str) -> tuple[dict, str]:
    """Generate a WebAuthn challenge using discoverable credentials."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not is_login_method_enabled(db, application.id, "passkey"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey login is disabled")

    rp_id = settings.webauthn_rp_id

    options = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=[],
        user_verification="required",
        timeout=60000,
    )

    challenge_b64 = bytes_to_base64url(options.challenge)

    challenge_id = _generate_challenge_id()
    _store_challenge(challenge_id, {
        "challenge": challenge_b64,
        "rp_id": rp_id,
        "origin": settings.webauthn_rp_origin,
    })

    return options_to_json_dict(options), challenge_id


def verify_authentication(
    db: Session,
    response: Response,
    *,
    client_id: str,
    redirect_uri: str,
    state: str | None,
    credential: dict,
    challenge_id: str,
) -> tuple[str, str | None]:
    """Verify a WebAuthn response.

    If the credential already exists → authenticate.
    If it's a new credential (userHandle present) → auto-register then authenticate.
    """
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not validate_redirect_uri(application, redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid redirect_uri")
    if not is_login_method_enabled(db, application.id, "passkey"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey login is disabled")

    challenge_data = _load_challenge(challenge_id)
    if not challenge_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired challenge")
    _delete_challenge(challenge_id)

    stored_cred = db.scalar(
        select(WebAuthnCredentialModel).where(
            WebAuthnCredentialModel.credential_id == credential["rawId"]
        )
    )

    if stored_cred is None:
        # New passkey — auto-register
        user = _auto_register_credential(
            db, credential=credential, challenge_data=challenge_data,
        )
    else:
        # Existing passkey — verify assertion
        user = db.get(User, stored_cred.user_id)
        if user is None or user.status != "active":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User not found or disabled")

        try:
            verified = verify_authentication_response(
                credential=credential,
                expected_challenge=challenge_data["challenge"],
                expected_rp_id=challenge_data["rp_id"],
                expected_origin=challenge_data["origin"],
                credential_public_key=base64url_to_bytes(stored_cred.public_key),
                credential_current_sign_count=stored_cred.sign_count,
                require_user_verification=False,
            )
        except InvalidAuthenticationResponse as exc:
            logger.warning("webauthn_auth_failed", detail=str(exc))
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="WebAuthn verification failed") from exc

        stored_cred.sign_count = verified.new_sign_count

    logger.info("webauthn_login_success", user_id=user.id)

    now = utcnow()
    membership = ensure_application_user(db, application=application, user=user)
    membership.last_login_at = now

    _set_sso_cookie_if_enabled(db, response, application, user.id)

    auth_code = create_authorization_code(
        db, application=application, user=user, redirect_uri=redirect_uri,
    )
    db.commit()
    db.refresh(auth_code)
    return auth_code.code, state


def _auto_register_credential(
    db: Session,
    *,
    credential: dict,
    challenge_data: dict,
) -> User:
    """Register a new WebAuthn credential and return the associated user."""
    response_data = credential.get("response", {})
    user_handle_b64 = response_data.get("userHandle")
    if not user_handle_b64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No userHandle in response — cannot auto-register. Use email login first.",
        )

    user_id_str = base64url_to_bytes(user_handle_b64).decode("utf-8")
    try:
        user_id = int(user_id_str)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid userHandle")

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=challenge_data["challenge"],
            expected_rp_id=challenge_data["rp_id"],
            expected_origin=challenge_data["origin"],
            require_user_verification=False,
        )
    except InvalidRegistrationResponse as exc:
        logger.warning("webauthn_auto_reg_failed", detail=str(exc))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WebAuthn registration failed") from exc

    transports = response_data.get("transports") or None

    new_cred = WebAuthnCredentialModel(
        user_id=user.id,
        credential_id=credential["id"],
        public_key=bytes_to_base64url(verified.credential_public_key),
        sign_count=verified.sign_count,
        transports=transports,
        aaguid=verified.aaguid.hex if verified.aaguid else None,
    )
    db.add(new_cred)

    identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "passkey",
            UserIdentity.provider_user_id == credential["id"],
        )
    )
    if identity is None:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="passkey",
                provider_user_id=credential["id"],
                provider_email=user.email,
                raw_profile={"aaguid": new_cred.aaguid},
            )
        )

    logger.info("webauthn_auto_registered", user_id=user.id)
    return user


def begin_registration(db: Session, client_id: str, email: str, display_name: str | None = None) -> tuple[dict, str]:
    """Generate a WebAuthn challenge for explicit passkey registration.

    This is used when a logged-in user wants to add another passkey.
    The discoverable-credentials login flow auto-registers on first use,
    so this endpoint is only needed for multi-device setup.
    """
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not is_login_method_enabled(db, application.id, "passkey"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey registration is disabled")

    normalized_email = email.lower()
    user = db.scalar(select(User).where(User.email == normalized_email))
    if user is None:
        user = get_or_create_email_user(db, email=normalized_email)

    user_id_bytes = str(user.id).encode("utf-8")

    existing_creds = db.scalars(
        select(WebAuthnCredentialModel).where(WebAuthnCredentialModel.user_id == user.id)
    ).all()
    exclude_creds = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id))
        for c in existing_creds
    ]

    rp_id = settings.webauthn_rp_id

    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=settings.webauthn_rp_name,
        user_name=normalized_email,
        user_display_name=display_name or user.display_name or normalized_email,
        user_id=user_id_bytes,
        exclude_credentials=exclude_creds or None,
        authenticator_selection={"authenticatorAttachment": "cross-platform", "residentKey": "required", "userVerification": "preferred"},
        timeout=60000,
        attestation="none",
    )

    challenge_b64 = bytes_to_base64url(options.challenge)

    challenge_id = _generate_challenge_id()
    _store_challenge(challenge_id, {
        "challenge": challenge_b64,
        "rp_id": rp_id,
        "origin": settings.webauthn_rp_origin,
        "user_id": user.id,
        "email": normalized_email,
    })

    return options_to_json_dict(options), challenge_id


def finish_registration(
    db: Session,
    response: Response,
    *,
    client_id: str,
    redirect_uri: str,
    state: str | None,
    email: str,
    display_name: str | None,
    credential: dict,
    challenge_id: str,
) -> tuple[str, str | None]:
    """Verify a WebAuthn registration attestation and save the credential."""
    application = get_active_application_by_client_id(db, client_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    if not validate_redirect_uri(application, redirect_uri):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid redirect_uri")
    if not is_login_method_enabled(db, application.id, "passkey"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey registration is disabled")

    challenge_data = _load_challenge(challenge_id)
    if not challenge_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired challenge")
    _delete_challenge(challenge_id)

    user = db.get(User, challenge_data["user_id"])
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=challenge_data["challenge"],
            expected_rp_id=challenge_data["rp_id"],
            expected_origin=challenge_data["origin"],
            require_user_verification=False,
        )
    except InvalidRegistrationResponse as exc:
        logger.warning("webauthn_reg_failed", detail=str(exc))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WebAuthn registration failed") from exc

    transports = credential.get("response", {}).get("transports") or None

    existing = db.scalar(
        select(WebAuthnCredentialModel).where(
            WebAuthnCredentialModel.credential_id == credential["id"]
        )
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Credential already registered")

    new_cred = WebAuthnCredentialModel(
        user_id=user.id,
        credential_id=credential["id"],
        public_key=bytes_to_base64url(verified.credential_public_key),
        sign_count=verified.sign_count,
        transports=transports,
        aaguid=verified.aaguid.hex if verified.aaguid else None,
    )
    db.add(new_cred)

    identity = db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "passkey",
            UserIdentity.provider_user_id == credential["id"],
        )
    )
    if identity is None:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="passkey",
                provider_email=email.lower(),
                provider_user_id=credential["id"],
                raw_profile={"aaguid": new_cred.aaguid},
            )
        )

    now = utcnow()
    membership = ensure_application_user(db, application=application, user=user)
    membership.last_login_at = now

    _set_sso_cookie_if_enabled(db, response, application, user.id)

    auth_code = create_authorization_code(
        db, application=application, user=user, redirect_uri=redirect_uri,
    )
    db.commit()
    db.refresh(auth_code)
    logger.info("webauthn_registration_success", user_id=user.id)
    return auth_code.code, state
