from __future__ import annotations

from concurrent.futures import Future
from pathlib import Path

from fastapi.testclient import TestClient

from app import ServiceConfig, create_app


class FakeTTS:
    speakers = ["p225"]

    def tts_to_file(self, *, text: str, file_path: str, speaker: str | None = None) -> None:
        Path(file_path).write_bytes(b"RIFFtest-wave")


class SubmitFailExecutor:
    def submit(self, *_args: object, **_kwargs: object) -> Future[str]:
        raise RuntimeError("submit failed")

    def shutdown(self, **_kwargs: object) -> None:
        return None


def test_executor_submit_failure_is_internal_not_not_ready() -> None:
    config = ServiceConfig(
        model_name="fake-model",
        max_text_chars=500,
        queue_capacity=1,
        synthesis_timeout_seconds=2.0,
        forced_voices=(),
    )
    application = create_app(config=config, model_loader=lambda _config: FakeTTS())

    with TestClient(application, raise_server_exceptions=False) as client:
        application.state.runtime._executor = SubmitFailExecutor()
        response = client.post("/api/tts", json={"text": "Hello", "voice": "p225"})

        assert response.status_code == 500
        assert response.json() == {
            "ok": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "The TTS service failed unexpectedly.",
            },
        }
        assert application.state.runtime.metrics().slots_in_use == 0
        assert application.state.runtime.tracked_temp_paths() == ()
