"""Security-focused tests for login backend."""

import pytest

from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    hash_secret,
    random_digits,
    random_token,
    verify_password,
    verify_secret,
)


class TestPasswordHashing:
    def test_bcrypt_hash_roundtrip(self):
        hashed = hash_password("secureP@ss123")
        assert verify_password("secureP@ss123", hashed) is True

    def test_bcrypt_rejects_wrong_password(self):
        hashed = hash_password("secureP@ss123")
        assert verify_password("wrongPassword", hashed) is False

    def test_bcrypt_different_passwords_different_hashes(self):
        h1 = hash_password("password1")
        h2 = hash_password("password2")
        assert h1 != h2

    def test_verify_password_handles_invalid_hash(self):
        assert verify_password("test", "not-a-valid-bcrypt-hash") is False

    def test_verify_password_handles_empty_password(self):
        hashed = hash_password("")
        assert verify_password("", hashed) is True
        assert verify_password("nonempty", hashed) is False


class TestSecretHashing:
    def test_hash_secret_is_deterministic(self):
        """hash_secret for tokens should be deterministic (HMAC)."""
        h1 = hash_secret("test-token")
        h2 = hash_secret("test-token")
        assert h1 == h2

    def test_hash_secret_has_sha256_prefix(self):
        result = hash_secret("anything")
        assert result.startswith("sha256:")

    def test_verify_secret_roundtrip(self):
        assert verify_secret("test-token", hash_secret("test-token")) is True

    def test_verify_secret_rejects_wrong_value(self):
        assert verify_secret("wrong", hash_secret("test-token")) is False

    def test_hash_secret_different_inputs_different_outputs(self):
        assert hash_secret("a") != hash_secret("b")


class TestRandomToken:
    def test_random_token_is_urlsafe(self):
        token = random_token()
        assert all(c.isalnum() or c in "-_" for c in token)

    def test_random_token_varies_between_calls(self):
        assert random_token() != random_token()

    def test_random_token_default_length(self):
        token = random_token()
        assert len(token) >= 32


class TestRandomDigits:
    def test_random_digits_returns_only_digits(self):
        code = random_digits()
        assert code.isdigit()

    def test_random_digits_default_length(self):
        code = random_digits()
        assert len(code) == 6

    def test_random_digits_custom_length(self):
        code = random_digits(length=4)
        assert len(code) == 4


class TestJwtTokens:
    def test_create_and_decode_access_token(self):
        token = create_access_token(
            subject="user:1",
            application_id=10,
            expires_in=3600,
        )
        payload = decode_access_token(token)
        assert payload["sub"] == "user:1"
        assert payload["application_id"] == 10

    def test_token_contains_iat_and_exp(self):
        token = create_access_token(
            subject="user:1",
            application_id=1,
            expires_in=600,
        )
        payload = decode_access_token(token)
        assert "iat" in payload
        assert "exp" in payload
        assert payload["exp"] > payload["iat"]

    def test_extra_claims_are_included(self):
        token = create_access_token(
            subject="user:1",
            application_id=1,
            expires_in=3600,
            extra_claims={"roles": ["admin"], "email": "a@b.com"},
        )
        payload = decode_access_token(token)
        assert payload["roles"] == ["admin"]
        assert payload["email"] == "a@b.com"

    def test_decode_invalid_token_raises(self):
        import jwt as pyjwt

        with pytest.raises(pyjwt.InvalidTokenError):
            decode_access_token("invalid.token.value")
