from __future__ import annotations

import threading
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app import ServiceConfig, create_app


class FakeTTS:
    speakers = ["p225", "p226"]

    def __init__(self) -> None:
        self.calls: list[dict[str, str | None]] = []
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def tts_to_file(self, *, text: str, file_path: str, speaker: str | None = None) -> None:
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            self.calls.append({"text": text, "speaker": speaker})
            Path(file_path).write_bytes(b"RIFFtest-wave")
        finally:
            with self.lock:
                self.active -= 1


class FailingTTS(FakeTTS):
    def tts_to_file(self, *, text: str, file_path: str, speaker: str | None = None) -> None:
        raise RuntimeError("backend failure")


class BlockingTTS(FakeTTS):
    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def tts_to_file(self, *, text: str, file_path: str, speaker: str | None = None) -> None:
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            self.started.set()
            self.release.wait(timeout=5)
            self.calls.append({"text": text, "speaker": speaker})
            Path(file_path).write_bytes(b"RIFFblocked-wave")
        finally:
            with self.lock:
                self.active -= 1


def config(**overrides: object) -> ServiceConfig:
    values: dict[str, object] = {
        "model_name": "fake-model",
        "max_text_chars": 500,
        "queue_capacity": 4,
        "synthesis_timeout_seconds": 2.0,
        "forced_voices": (),
    }
    values.update(overrides)
    return ServiceConfig(**values)  # type: ignore[arg-type]


def test_liveness_readiness_and_voices() -> None:
    backend = FakeTTS()
    application = create_app(config=config(), model_loader=lambda _config: backend)

    with TestClient(application) as client:
        assert client.get("/api/ping").json() == {"ok": True}
        assert client.get("/api/ready").json() == {"ok": True, "ready": True}
        assert client.get("/api/voices").json() == {"voices": ["p225", "p226"]}


def test_synthesis_returns_audio_and_cleans_temp_file() -> None:
    backend = FakeTTS()
    application = create_app(config=config(), model_loader=lambda _config: backend)

    with TestClient(application) as client:
        response = client.post("/api/tts", json={"text": "Hello", "voice": "p225"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("audio/wav")
        assert response.content.startswith(b"RIFF")
        assert backend.calls == [{"text": "Hello", "speaker": "p225"}]
        assert application.state.runtime.tracked_temp_paths() == ()


def test_empty_oversized_and_invalid_voice_requests_are_rejected() -> None:
    backend = FakeTTS()
    application = create_app(config=config(max_text_chars=5), model_loader=lambda _config: backend)

    with TestClient(application) as client:
        empty = client.post("/api/tts", json={"text": "   "})
        oversized = client.post("/api/tts", json={"text": "123456"})
        invalid_voice = client.post("/api/tts", json={"text": "Hello", "voice": "missing"})

        assert empty.status_code == 400
        assert empty.json()["error"]["code"] == "EMPTY_TEXT"
        assert oversized.status_code == 413
        assert oversized.json()["error"]["code"] == "TEXT_TOO_LONG"
        assert invalid_voice.status_code == 400
        assert invalid_voice.json()["error"]["code"] == "INVALID_VOICE"
        assert application.state.runtime.tracked_temp_paths() == ()


def test_synthesis_failure_is_generic_and_cleans_temp_file() -> None:
    application = create_app(config=config(), model_loader=lambda _config: FailingTTS())

    with TestClient(application) as client:
        response = client.post("/api/tts", json={"text": "Hello", "voice": "p225"})
        assert response.status_code == 500
        assert response.json() == {
            "ok": False,
            "error": {"code": "SYNTHESIS_FAILED", "message": "Speech synthesis failed."},
        }
        assert application.state.runtime.tracked_temp_paths() == ()


def test_queue_is_bounded_and_model_inference_never_overlaps() -> None:
    backend = BlockingTTS()
    application = create_app(
        config=config(queue_capacity=1, synthesis_timeout_seconds=4.0),
        model_loader=lambda _config: backend,
    )

    first_result: dict[str, int] = {}
    with TestClient(application) as client:
        def run_first() -> None:
            first_result["status"] = client.post(
                "/api/tts",
                json={"text": "First", "voice": "p225"},
            ).status_code

        thread = threading.Thread(target=run_first)
        thread.start()
        assert backend.started.wait(timeout=2)

        second = client.post("/api/tts", json={"text": "Second", "voice": "p225"})
        assert second.status_code == 429
        assert second.json()["error"]["code"] == "QUEUE_FULL"

        backend.release.set()
        thread.join(timeout=5)
        assert first_result["status"] == 200
        assert backend.max_active == 1


def test_timeout_eventually_cleans_the_output_file() -> None:
    backend = BlockingTTS()
    application = create_app(
        config=config(queue_capacity=1, synthesis_timeout_seconds=0.01),
        model_loader=lambda _config: backend,
    )

    with TestClient(application) as client:
        response = client.post("/api/tts", json={"text": "Slow", "voice": "p225"})
        assert response.status_code == 504
        assert response.json()["error"]["code"] == "SYNTHESIS_TIMEOUT"
        backend.release.set()
        for _ in range(100):
            if application.state.runtime.tracked_temp_paths() == ():
                break
            time.sleep(0.01)
        assert application.state.runtime.tracked_temp_paths() == ()


def test_host_play_and_debug_endpoints_do_not_exist() -> None:
    application = create_app(config=config(), model_loader=lambda _config: FakeTTS())

    with TestClient(application) as client:
        assert client.post("/api/tts/play", json={"text": "Hello"}).status_code == 404
        assert client.get("/api/playing").status_code == 404
        assert client.post("/api/tts/cancel").status_code == 404
        assert client.get("/api/debug").status_code == 404
