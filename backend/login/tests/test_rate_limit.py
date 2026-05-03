"""Rate limiting tests."""

import pytest
from unittest.mock import MagicMock, patch

from app.services.rate_limit import (
    RateLimitExceeded,
    _is_trusted,
    check_login_lockout,
    check_request_code_rate_limit,
    clear_failed_login,
    get_client_ip,
    record_failed_login,
)


class TestGetClientIp:
    def test_returns_client_host_when_no_forwarded_header(self):
        request = MagicMock()
        request.headers = {}
        request.client = MagicMock()
        request.client.host = "1.2.3.4"
        assert get_client_ip(request) == "1.2.3.4"

    def test_skips_trusted_proxy(self):
        request = MagicMock()
        request.headers = {"x-forwarded-for": "1.2.3.4, 127.0.0.1"}
        request.client = MagicMock()
        request.client.host = "0.0.0.0"
        assert get_client_ip(request) == "1.2.3.4"

    def test_uses_last_untrusted_ip(self):
        request = MagicMock()
        request.headers = {"x-forwarded-for": "10.0.0.1, 1.2.3.4, 127.0.0.1"}
        request.client = MagicMock()
        request.client.host = "0.0.0.0"
        assert get_client_ip(request) == "1.2.3.4"

    def test_returns_client_host_when_header_is_empty_string(self):
        request = MagicMock()
        request.headers = {"x-forwarded-for": ""}
        request.client = MagicMock()
        request.client.host = "5.6.7.8"
        assert get_client_ip(request) == "5.6.7.8"

    def test_returns_unknown_when_no_client(self):
        request = MagicMock()
        request.headers = {}
        request.client = None
        assert get_client_ip(request) == "unknown"

    def test_skips_ipv6_localhost(self):
        request = MagicMock()
        request.headers = {"x-forwarded-for": "2001:db8::1, ::1"}
        request.client = MagicMock()
        request.client.host = "0.0.0.0"
        assert get_client_ip(request) == "2001:db8::1"


class TestIsTrusted:
    def test_localhost_is_trusted(self):
        assert _is_trusted("127.0.0.1") is True

    def test_ipv6_localhost_is_trusted(self):
        assert _is_trusted("::1") is True

    def test_regular_ip_is_not_trusted(self):
        assert _is_trusted("1.2.3.4") is False

    def test_invalid_ip_is_not_trusted(self):
        assert _is_trusted("not-an-ip") is False


class TestRateLimitExceeded:
    def test_exception_carries_detail_and_retry_after(self):
        exc = RateLimitExceeded("Email rate limit exceeded", 45)
        assert exc.detail == "Email rate limit exceeded"
        assert exc.retry_after == 45


class TestCheckRequestCodeRateLimit:
    def test_passes_when_redis_is_none(self):
        check_request_code_rate_limit(None, "test@example.com", "1.2.3.4")

    def test_raises_when_email_rate_exceeded(self):
        redis_mock = MagicMock()
        redis_mock.incr.return_value = 10
        with patch("app.services.rate_limit.settings") as mock_settings:
            mock_settings.rate_limit_email_per_minute = 5
            with pytest.raises(RateLimitExceeded):
                check_request_code_rate_limit(redis_mock, "test@example.com", "1.2.3.4")

    def test_raises_when_ip_rate_exceeded(self):
        redis_mock = MagicMock()
        redis_mock.incr.side_effect = [1, 20]
        with patch("app.services.rate_limit.settings") as mock_settings:
            mock_settings.rate_limit_email_per_minute = 5
            mock_settings.rate_limit_ip_per_hour = 10
            with pytest.raises(RateLimitExceeded):
                check_request_code_rate_limit(redis_mock, "test@example.com", "1.2.3.4")


class TestLoginLockout:
    def test_record_passed_when_redis_is_none(self):
        record_failed_login(None, "test@example.com", "1.2.3.4")

    def test_check_passed_when_redis_is_none(self):
        check_login_lockout(None, "test@example.com", "1.2.3.4")

    def test_clear_passed_when_redis_is_none(self):
        clear_failed_login(None, "test@example.com", "1.2.3.4")

    def test_lockout_raises_when_failed_attempts_exceeded(self):
        redis_mock = MagicMock()
        redis_mock.get.return_value = b"6"
        redis_mock.ttl.return_value = 300
        with patch("app.services.rate_limit.settings") as mock_settings:
            mock_settings.rate_limit_failed_attempts = 5
            with pytest.raises(RateLimitExceeded) as exc_info:
                check_login_lockout(redis_mock, "test@example.com", "1.2.3.4")
            assert exc_info.value.detail == "Account temporarily locked"

    def test_lockout_passes_when_under_threshold(self):
        redis_mock = MagicMock()
        redis_mock.get.return_value = b"3"
        with patch("app.services.rate_limit.settings") as mock_settings:
            mock_settings.rate_limit_failed_attempts = 5
            check_login_lockout(redis_mock, "test@example.com", "1.2.3.4")

    def test_lockout_passes_when_no_record(self):
        redis_mock = MagicMock()
        redis_mock.get.return_value = None
        check_login_lockout(redis_mock, "test@example.com", "1.2.3.4")

    def test_clear_deletes_key(self):
        redis_mock = MagicMock()
        clear_failed_login(redis_mock, "test@example.com", "1.2.3.4")
        redis_mock.delete.assert_called_once_with("rl:lock:test@example.com:1.2.3.4")
