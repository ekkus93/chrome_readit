from __future__ import annotations

import io
import json
import urllib.error
from typing import Any

import healthcheck


class JsonResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def __enter__(self) -> "JsonResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, _amount: int | None = None) -> bytes:
        return json.dumps(self.payload).encode()


def http_error(status: int, payload: dict[str, Any]) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        healthcheck.URL,
        status,
        "failure",
        hdrs=None,
        fp=io.BytesIO(json.dumps(payload).encode()),
    )


def test_healthcheck_accepts_ready_service(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        healthcheck.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: JsonResponse({"ok": True, "ready": True}),
    )

    assert healthcheck.main() == 0


def test_healthcheck_treats_queue_saturation_as_healthy(monkeypatch: Any) -> None:
    def saturated(*_args: object, **_kwargs: object) -> object:
        raise http_error(503, {"ok": False, "error": {"code": "QUEUE_FULL"}})

    monkeypatch.setattr(healthcheck.urllib.request, "urlopen", saturated)
    assert healthcheck.main() == 0


def test_healthcheck_rejects_not_ready_and_transport_failures(monkeypatch: Any) -> None:
    def not_ready(*_args: object, **_kwargs: object) -> object:
        raise http_error(503, {"ok": False, "error": {"code": "NOT_READY"}})

    monkeypatch.setattr(healthcheck.urllib.request, "urlopen", not_ready)
    assert healthcheck.main() == 1

    def unavailable(*_args: object, **_kwargs: object) -> object:
        raise OSError("connection refused")

    monkeypatch.setattr(healthcheck.urllib.request, "urlopen", unavailable)
    assert healthcheck.main() == 1


def test_healthcheck_rejects_incomplete_success_payload(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        healthcheck.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: JsonResponse({"ok": True, "ready": False}),
    )
    assert healthcheck.main() == 1


def test_healthcheck_rejects_invalid_http_error_payload(monkeypatch: Any) -> None:
    def invalid_json(*_args: object, **_kwargs: object) -> object:
        raise urllib.error.HTTPError(
            healthcheck.URL,
            503,
            "failure",
            hdrs=None,
            fp=io.BytesIO(b"not-json"),
        )

    monkeypatch.setattr(healthcheck.urllib.request, "urlopen", invalid_json)
    assert healthcheck.main() == 1


def test_healthcheck_rejects_non_object_queue_error(monkeypatch: Any) -> None:
    def non_object(*_args: object, **_kwargs: object) -> object:
        raise urllib.error.HTTPError(
            healthcheck.URL,
            503,
            "failure",
            hdrs=None,
            fp=io.BytesIO(b"[]"),
        )

    monkeypatch.setattr(healthcheck.urllib.request, "urlopen", non_object)
    assert healthcheck.main() == 1
