from __future__ import annotations

import logging
import math
import os
import tempfile
import threading
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Protocol

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

LOGGER = logging.getLogger("chrome-readit-coqui")


class TTSBackend(Protocol):
    def tts_to_file(self, *, text: str, file_path: str, speaker: str | None = None) -> None: ...


def _positive_int_environment(name: str, default: str) -> int:
    raw = os.environ.get(name, default).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _positive_float_environment(name: str, default: str) -> float:
    raw = os.environ.get(name, default).strip()
    try:
        value = float(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive finite number") from error
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive finite number")
    return value


def _deduplicate_strings(values: Iterable[object]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        candidate = str(value).strip()
        if candidate and candidate not in seen:
            seen.add(candidate)
            output.append(candidate)
    return output


@dataclass(frozen=True)
class ServiceConfig:
    model_name: str
    max_text_chars: int
    queue_capacity: int
    synthesis_timeout_seconds: float
    forced_voices: tuple[str, ...]

    @classmethod
    def from_environment(cls) -> "ServiceConfig":
        model_name = os.environ.get("COQUI_MODEL", "tts_models/en/vctk/vits").strip()
        if not model_name:
            raise ValueError("COQUI_MODEL must not be empty")
        forced_voices = tuple(_deduplicate_strings(os.environ.get("COQUI_VOICES", "").split(",")))
        return cls(
            model_name=model_name,
            max_text_chars=_positive_int_environment("MAX_TEXT_CHARS", "500"),
            queue_capacity=_positive_int_environment("SYNTH_QUEUE_CAPACITY", "4"),
            synthesis_timeout_seconds=_positive_float_environment("SYNTH_TIMEOUT_SECONDS", "120"),
            forced_voices=forced_voices,
        )


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None


class InvalidVoiceError(ValueError):
    pass


class BackendNotReadyError(RuntimeError):
    pass


ModelLoader = Callable[[ServiceConfig], TTSBackend]


def load_coqui_model(config: ServiceConfig) -> TTSBackend:
    try:
        from TTS.api import TTS
    except Exception as error:  # pragma: no cover - exercised by real container smoke tests
        raise RuntimeError(f"Failed to import Coqui TTS: {error}") from error

    return TTS(model_name=config.model_name, progress_bar=False, gpu=False)


def discover_voices(backend: object, forced_voices: tuple[str, ...] = ()) -> list[str]:
    if forced_voices:
        return list(forced_voices)

    for attribute in ("speakers", "available_speakers", "voices", "available_voices"):
        value = getattr(backend, attribute, None)
        if isinstance(value, dict) and value:
            return _deduplicate_strings(value.keys())
        if isinstance(value, (list, tuple, set)) and value:
            return _deduplicate_strings(value)
    return []


@dataclass(frozen=True)
class RuntimeMetrics:
    queue_capacity: int
    slots_in_use: int
    active_inference: int
    queued_futures: int
    timed_out_running: int
    tracked_temp_files: int
    cleanup_failures: int

    @property
    def accepting_requests(self) -> bool:
        return self.slots_in_use < self.queue_capacity


class SynthesisRuntime:
    def __init__(self, config: ServiceConfig, model_loader: ModelLoader) -> None:
        self.config = config
        self._model_loader = model_loader
        self._backend: TTSBackend | None = None
        self._voices: tuple[str, ...] = ()
        self._executor: ThreadPoolExecutor | None = None
        self._slots = threading.BoundedSemaphore(config.queue_capacity)
        self._metrics_lock = threading.Lock()
        self._slots_in_use = 0
        self._active_inference = 0
        self._queued_futures = 0
        self._timed_out_futures: set[Future[str]] = set()
        self._temp_paths: set[str] = set()
        self._active_paths: set[str] = set()
        self._cleanup_failures: dict[str, int] = {}
        self._temp_paths_lock = threading.Lock()
        self.ready = False

    def start(self) -> None:
        backend = self._model_loader(self.config)
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="coqui-synthesis")
        self._backend = backend
        self._voices = tuple(discover_voices(backend, self.config.forced_voices))
        self._executor = executor
        self.ready = True

    def shutdown(self) -> None:
        self.ready = False
        executor = self._executor
        self._executor = None
        if executor is not None:
            # In-process Coqui inference cannot be force-cancelled safely. This
            # returns promptly, cancels work that has not started, and leaves
            # active paths tracked until their worker callback actually exits.
            executor.shutdown(wait=False, cancel_futures=True)
        with self._temp_paths_lock:
            retryable_paths = list(self._temp_paths - self._active_paths)
        for path in retryable_paths:
            self.cleanup_path(path)
        self._backend = None
        self._voices = ()

    def voices(self) -> list[str]:
        return list(self._voices)

    def metrics(self) -> RuntimeMetrics:
        with self._metrics_lock, self._temp_paths_lock:
            return RuntimeMetrics(
                queue_capacity=self.config.queue_capacity,
                slots_in_use=self._slots_in_use,
                active_inference=self._active_inference,
                queued_futures=self._queued_futures,
                timed_out_running=len(self._timed_out_futures),
                tracked_temp_files=len(self._temp_paths),
                cleanup_failures=sum(self._cleanup_failures.values()),
            )

    def tracked_temp_paths(self) -> tuple[str, ...]:
        with self._temp_paths_lock:
            return tuple(sorted(self._temp_paths))

    def cleanup_failures(self) -> dict[str, int]:
        with self._temp_paths_lock:
            return dict(self._cleanup_failures)

    def cleanup_path(self, path: str) -> bool:
        with self._temp_paths_lock:
            if path in self._active_paths:
                return False
        candidate = Path(path)
        try:
            candidate.unlink(missing_ok=True)
        except OSError:
            with self._temp_paths_lock:
                self._temp_paths.add(path)
                self._cleanup_failures[path] = self._cleanup_failures.get(path, 0) + 1
            LOGGER.exception("Temporary audio cleanup failed")
            return False

        with self._temp_paths_lock:
            self._temp_paths.discard(path)
            self._cleanup_failures.pop(path, None)
        return True

    def _resolve_voice(self, voice: str | None) -> str | None:
        if not self._voices:
            return None
        selected = voice.strip() if isinstance(voice, str) and voice.strip() else self._voices[0]
        if selected not in self._voices:
            raise InvalidVoiceError(f"Voice '{selected}' is not available")
        return selected

    def _acquire_slot(self) -> None:
        if not self._slots.acquire(blocking=False):
            raise OverflowError("Synthesis queue is full")
        with self._metrics_lock:
            self._slots_in_use += 1
            if self._slots_in_use > self.config.queue_capacity:
                self._slots_in_use -= 1
                self._slots.release()
                raise RuntimeError("Synthesis queue accounting exceeded capacity")

    def _release_slot(self, future: Future[str] | None = None) -> None:
        with self._metrics_lock:
            if future is not None:
                self._timed_out_futures.discard(future)
            if self._slots_in_use <= 0:
                raise RuntimeError("Synthesis queue accounting became negative")
            self._slots_in_use -= 1
        self._slots.release()

    def _run_synthesis(
        self,
        backend: TTSBackend,
        text: str,
        selected_voice: str | None,
        output_path: str,
    ) -> str:
        with self._metrics_lock:
            if self._queued_futures <= 0:
                raise RuntimeError("Queued synthesis accounting became negative")
            self._queued_futures -= 1
            self._active_inference += 1
        with self._temp_paths_lock:
            self._active_paths.add(output_path)
        try:
            if selected_voice is None:
                backend.tts_to_file(text=text, file_path=output_path)
            else:
                backend.tts_to_file(text=text, file_path=output_path, speaker=selected_voice)

            output = Path(output_path)
            if not output.exists() or output.stat().st_size <= 0:
                raise RuntimeError("TTS backend produced an empty audio file")
            return output_path
        finally:
            with self._temp_paths_lock:
                self._active_paths.discard(output_path)
            with self._metrics_lock:
                if self._active_inference <= 0:
                    raise RuntimeError("Active inference accounting became negative")
                self._active_inference -= 1

    def _future_completed(self, future: Future[str], output_path: str) -> None:
        if future.cancelled():
            with self._metrics_lock:
                if self._queued_futures <= 0:
                    raise RuntimeError("Queued synthesis accounting became negative")
                self._queued_futures -= 1
            self.cleanup_path(output_path)
        self._release_slot(future)

    def submit(self, text: str, voice: str | None) -> tuple[Future[str], str]:
        backend = self._backend
        executor = self._executor
        if not self.ready or backend is None or executor is None:
            raise BackendNotReadyError("TTS backend is not ready")

        selected_voice = self._resolve_voice(voice)
        self._acquire_slot()
        output_path: str | None = None
        descriptor: int | None = None
        future: Future[str] | None = None
        try:
            descriptor, output_path = tempfile.mkstemp(suffix=".wav", prefix="chrome-readit-")
            os.close(descriptor)
            descriptor = None
            with self._temp_paths_lock:
                self._temp_paths.add(output_path)
            with self._metrics_lock:
                self._queued_futures += 1
            try:
                future = executor.submit(self._run_synthesis, backend, text, selected_voice, output_path)
            except Exception:
                with self._metrics_lock:
                    self._queued_futures -= 1
                raise
            future.add_done_callback(lambda completed: self._future_completed(completed, output_path))
            return future, output_path
        except Exception:
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    LOGGER.exception("Temporary descriptor cleanup failed")
            if output_path is not None:
                self.cleanup_path(output_path)
            if future is None:
                self._release_slot()
            raise

    def mark_timed_out(self, future: Future[str]) -> None:
        with self._metrics_lock:
            if not future.done():
                self._timed_out_futures.add(future)


def error_payload(code: str, message: str) -> dict[str, object]:
    return {"ok": False, "error": {"code": code, "message": message}}


def raise_api_error(status_code: int, code: str, message: str) -> None:
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message})


def create_app(
    *,
    config: ServiceConfig | None = None,
    model_loader: ModelLoader = load_coqui_model,
) -> FastAPI:
    service_config = config or ServiceConfig.from_environment()
    application = FastAPI(title="Chrome Read It Coqui TTS", docs_url=None, redoc_url=None)
    runtime = SynthesisRuntime(service_config, model_loader)
    application.state.runtime = runtime

    @application.on_event("startup")
    def startup_event() -> None:
        runtime.start()

    @application.on_event("shutdown")
    def shutdown_event() -> None:
        runtime.shutdown()

    @application.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exception: HTTPException) -> JSONResponse:
        detail = exception.detail
        if isinstance(detail, dict) and isinstance(detail.get("code"), str):
            payload = error_payload(str(detail["code"]), str(detail.get("message", "Request failed")))
        else:
            payload = error_payload("HTTP_ERROR", str(detail))
        return JSONResponse(status_code=exception.status_code, content=payload)

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(_request: Request, _exception: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content=error_payload("INVALID_REQUEST", "The request body is invalid."))

    @application.exception_handler(Exception)
    async def unexpected_exception_handler(_request: Request, _exception: Exception) -> JSONResponse:
        LOGGER.exception("Unhandled TTS service error")
        return JSONResponse(
            status_code=500,
            content=error_payload("INTERNAL_ERROR", "The TTS service failed unexpectedly."),
        )

    @application.get("/api/ping")
    def ping() -> dict[str, bool]:
        return {"ok": True}

    @application.get("/api/ready")
    def ready() -> dict[str, object]:
        if not runtime.ready:
            raise_api_error(503, "NOT_READY", "The TTS model is not ready.")
        metrics = runtime.metrics()
        if not metrics.accepting_requests:
            raise_api_error(503, "QUEUE_FULL", "The synthesis queue is full.")
        return {
            "ok": True,
            "ready": True,
            "accepting_requests": True,
            "queue_capacity": metrics.queue_capacity,
            "slots_in_use": metrics.slots_in_use,
            "active_inference": metrics.active_inference,
            "queued_futures": metrics.queued_futures,
            "timed_out_running": metrics.timed_out_running,
        }

    @application.get("/api/voices")
    def voices() -> dict[str, list[str]]:
        if not runtime.ready:
            raise_api_error(503, "NOT_READY", "The TTS model is not ready.")
        return {"voices": runtime.voices()}

    @application.post("/api/tts")
    def synthesize(request: TTSRequest) -> FileResponse:
        text = request.text.strip()
        if not text:
            raise_api_error(400, "EMPTY_TEXT", "Text must not be empty.")
        if len(text) > service_config.max_text_chars:
            raise_api_error(413, "TEXT_TOO_LONG", f"Text exceeds the {service_config.max_text_chars}-character limit.")
        if not runtime.ready:
            raise_api_error(503, "NOT_READY", "The TTS model is not ready.")

        try:
            future, output_path = runtime.submit(text, request.voice)
        except InvalidVoiceError as error:
            raise_api_error(400, "INVALID_VOICE", str(error))
        except OverflowError:
            raise_api_error(429, "QUEUE_FULL", "The synthesis queue is full.")
        except BackendNotReadyError:
            raise_api_error(503, "NOT_READY", "The TTS model is not ready.")
        except Exception:
            LOGGER.exception("Synthesis submission failed")
            raise_api_error(500, "INTERNAL_ERROR", "The TTS service failed unexpectedly.")

        try:
            completed_path = future.result(timeout=service_config.synthesis_timeout_seconds)
        except FutureTimeoutError:
            runtime.mark_timed_out(future)
            future.add_done_callback(lambda _future: runtime.cleanup_path(output_path))
            raise_api_error(504, "SYNTHESIS_TIMEOUT", "Speech synthesis timed out.")
        except Exception:
            runtime.cleanup_path(output_path)
            raise_api_error(500, "SYNTHESIS_FAILED", "Speech synthesis failed.")

        return FileResponse(
            completed_path,
            media_type="audio/wav",
            background=BackgroundTask(runtime.cleanup_path, completed_path),
        )

    return application


app = create_app()
