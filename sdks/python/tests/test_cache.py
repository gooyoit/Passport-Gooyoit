"""Thread-safety tests for TTLCache."""

import threading

from passport_gooyoit import TTLCache


def test_concurrent_get_of_expired_key_does_not_raise():
    cache = TTLCache(ttl=-1)  # entries are already expired
    cache.set("k", "v")

    errors: list[Exception] = []

    def hit() -> None:
        try:
            assert cache.get("k") is None
        except Exception as exc:  # noqa: BLE001 - collect for assertion
            errors.append(exc)

    threads = [threading.Thread(target=hit) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []


def test_set_evicts_oldest_beyond_maxsize():
    cache = TTLCache(ttl=60, maxsize=2)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    assert cache.get("a") is None
    assert cache.get("b") == 2
    assert cache.get("c") == 3
