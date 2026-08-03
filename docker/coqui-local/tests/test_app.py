from __future__ import annotations

import os
import threading
import time
from concurrent.futures import Future
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import InvalidVoiceError, ServiceConfig, SynthesisRuntime, create_app


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


class SubmitFailExecutor:
    def submit(self, *_args: object, **_kwargs: object) -> Future[str]:
        raise RuntimeError("submit failed")

    def shutdown(self, **_kwargs: object) -> None:
        return None


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


def wait_until(predicate: object, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if callable(predicate) and predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition did not become true")


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("MAX_TEXT_CHARS", "bad"),
        ("MAX_TEXT_CHARS", "0"),
        ("MAX_TEXT_CHARS", "-1"),
        ("SYNTH_QUEUE_CAPACITY", "bad"),
        ("SYNTH_QUEUE_CAPACITY", "0"),
        ("SYNTH_TIMEOUT_SECONDS", "bad"),
        ("SYNTH_TIMEOUT_SECONDS", "0"),
        ("SYNTH_TIMEOUT_SECONDS", "nan"),
        ("SYNTH_TIMEOUT_SECONDS", "inf"),
        ("COQUI_MODEL", ""),
    ],
)
def test_invalid_environment_configuration_fails_fast(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        ServiceConfig.from_environment()


def test_environment_forced_voices_are_trimmed_and_deduplicated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COQUI_VOICES", " p225,p226,p225, ,p226 ")
    assert ServiceConfig.from_environment().forced_voices == ("p225", "p226")


def test_liveness_readiness_and_voices_report_queue_state() -> None:
    backend = FakeTTS()
    application = create_app(config=config(), model_loader=lambda _config: backend)

    with TestClient(application) as client:
        assert client.get("/api/ping").json() == {"ok": True}
        ready = client.get("/api/ready")
        assert ready.status_code == 200
        assert ready.json() == {
            "ok": True,
            "ready": True,
            "accepting_requests": True,
            "queue_capacity": 4,
            "slots_in_use": 0,
            "active_inference": 0,
            "queued_futures": 0,
            "timed_out_running": 0,
        }
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
        assert application.state.runtime.metrics().slots_in_use == 0


def test_empty_oversized_and_invalid_voice_requests_are_rejected_before_queue_use(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend = FakeTTS()
    application = create_app(config=config(max_text_chars=5), model_loader=lambda _config: backend)
    mkstemp = app_module.tempfile.mkstemp
    mkstemp_spy = pytest.MonkeyPatch()
    calls = 0

    def counted_mkstemp(*args: object, **kwargs: object) -> tuple[int, str]:
        nonlocal calls
        calls += 1
        return mkstemp(*args, **kwargs)

    monkeypatch.setattr(app_module.tempfile, "mkstemp", counted_mkstemp)
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
        assert calls == 0
        assert backend.calls == []
        assert application.state.runtime.metrics().slots_in_use == 0
    mkstemp_spy.undo()


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
        assert application.state.runtime.metrics().slots_in_use == 0


def test_queue_is_bounded_model_inference_never_overlaps_and_readiness_saturates() -> None:
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

        ready = client.get("/api/ready")
        assert ready.status_code == 503
        assert ready.json()["error"]["code"] == "QUEUE_FULL"
        second = client.post("/api/tts", json={"text": "Second", "voice": "p225"})
        assert second.status_code == 429
        assert second.json()["error"]["code"] == "QUEUE_FULL"

        backend.release.set()
        thread.join(timeout=5)
        assert first_result["status"] == 200
        assert backend.max_active == 1
        assert application.state.runtime.metrics().slots_in_use == 0


def test_timeout_remains_visible_until_underlying_work_finishes() -> None:
    backend = BlockingTTS()
    application = create_app(
        config=config(queue_capacity=1, synthesis_timeout_seconds=0.01),
        model_loader=lambda _config: backend,
    )

    with TestClient(application) as client:
        response = client.post("/api/tts", json={"text": "Slow", "voice": "p225"})
        assert response.status_code == 504
        assert response.json()["error"]["code"] == "SYNTHESIS_TIMEOUT"
        metrics = application.state.runtime.metrics()
        assert metrics.slots_in_use == 1
        assert metrics.timed_out_running == 1
        assert client.get("/api/ready").status_code == 503

        backend.release.set()
        wait_until(lambda: application.state.runtime.tracked_temp_paths() == ())
        wait_until(lambda: application.state.runtime.metrics().slots_in_use == 0)
        assert application.state.runtime.metrics().timed_out_running == 0
        assert client.get("/api/ready").status_code == 200


@pytest.mark.parametrize("failure", ["mkstemp", "close", "submit"])
def test_pre_submit_failures_restore_queue_capacity(
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    backend = FakeTTS()
    runtime = SynthesisRuntime(config(queue_capacity=1), lambda _config: backend)
    runtime.start()

    if failure == "mkstemp":
        monkeypatch.setattr(app_module.tempfile, "mkstemp", lambda **_kwargs: (_ for _ in ()).throw(OSError("disk full")))
    elif failure == "close":
        real_close = os.close

        def close_then_fail(descriptor: int) -> None:
            real_close(descriptor)
            raise OSError("close failed")

        monkeypatch.setattr(app_module.os, "close", close_then_fail)
    else:
        runtime._executor = SubmitFailExecutor()  # type: ignore[assignment]

    with pytest.raises((OSError, RuntimeError)):
        runtime.submit("Hello", "p225")
    assert runtime.metrics().slots_in_use == 0
    assert runtime.tracked_temp_paths() == ()
    runtime.shutdown()


def test_cleanup_failure_remains_tracked_until_retry_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    backend = FakeTTS()
    runtime = SynthesisRuntime(config(), lambda _config: backend)
    runtime.start()
    future, output_path = runtime.submit("Hello", "p225")
    assert future.result(timeout=2) == output_path

    real_unlink = Path.unlink
    attempts = 0

    def fail_once(path: Path, *args: object, **kwargs: object) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OSError("temporary failure")
        real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_once)
    assert runtime.cleanup_path(output_path) is False
    assert runtime.tracked_temp_paths() == (output_path,)
    assert runtime.cleanup_failures()[output_path] == 1
    assert runtime.cleanup_path(output_path) is True
    assert runtime.tracked_temp_paths() == ()
    assert runtime.cleanup_failures() == {}
    runtime.shutdown()


def test_shutdown_returns_with_blocked_inference_and_work_finishes_later() -> None:
    backend = BlockingTTS()
    runtime = SynthesisRuntime(config(queue_capacity=1), lambda _config: backend)
    runtime.start()
    future, output_path = runtime.submit("Hello", "p225")
    assert backend.started.wait(timeout=2)

    started = time.monotonic()
    runtime.shutdown()
    assert time.monotonic() - started < 1.0
    assert runtime.ready is False

    backend.release.set()
    assert future.result(timeout=2) == output_path
    runtime.cleanup_path(output_path)


def test_unexpected_error_uses_stable_generic_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    application = create_app(config=config(), model_loader=lambda _config: FakeTTS())
    with TestClient(application, raise_server_exceptions=False) as client:
        monkeypatch.setattr(application.state.runtime, "metrics", lambda: (_ for _ in ()).throw(RuntimeError("secret path")))
        response = client.get("/api/ready")
        assert response.status_code == 500
        assert response.json() == {
            "ok": False,
            "error": {"code": "INTERNAL_ERROR", "message": "The TTS service failed unexpectedly."},
        }
        assert "secret path" not in response.text


def test_host_play_and_debug_endpoints_do_not_exist() -> None:
    application = create_app(config=config(), model_loader=lambda _config: FakeTTS())

    with TestClient(application) as client:
        assert client.post("/api/tts/play", json={"text": "Hello"}).status_code == 404
        assert client.get("/api/playing").status_code == 404
        assert client.post("/api/tts/cancel").status_code == 404
        assert client.get("/api/debug").status_code == 404
