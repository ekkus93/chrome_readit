from __future__ import annotations

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


class TTSBackend(Protocol):
    def tts_to_file(self, *, text: str, file_path: str, speaker: str | None = None) -> None: ...


@dataclass(frozen=True)
class ServiceConfig:
    model_name: str
    max_text_chars: int
    queue_capacity: int
    synthesis_timeout_seconds: float
    forced_voices: tuple[str, ...]

    @classmethod
    def from_environment(cls) -> "ServiceConfig":
        forced_voices = tuple(
            voice.strip()
            for voice in os.environ.get("COQUI_VOICES", "").split(",")
            if voice.strip()
        )
        return cls(
            model_name=os.environ.get("COQUI_MODEL", "tts_models/en/vctk/vits"),
            max_text_chars=max(1, int(os.environ.get("MAX_TEXT_CHARS", "500"))),
            queue_capacity=max(1, int(os.environ.get("SYNTH_QUEUE_CAPACITY", "4"))),
            synthesis_timeout_seconds=max(1.0, float(os.environ.get("SYNTH_TIMEOUT_SECONDS", "120"))),
            forced_voices=forced_voices,
        )


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None


class InvalidVoiceError(ValueError):
    pass


ModelLoader = Callable[[ServiceConfig], TTSBackend]


def load_coqui_model(config: ServiceConfig) -> TTSBackend:
    try:
        from TTS.api import TTS
    except Exception as error:  # pragma: no cover - exercised by real container smoke tests
        raise RuntimeError(f"Failed to import Coqui TTS: {error}") from error

    return TTS(model_name=config.model_name, progress_bar=False, gpu=False)


def _deduplicate_strings(values: Iterable[object]) -> list[str]:
    output: list[str] = []
    for value in values:
        candidate = str(value).strip()
        if candidate and candidate not in output:
            output.append(candidate)
    return output


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


class SynthesisRuntime:
    def __init__(self, config: ServiceConfig, model_loader: ModelLoader) -> None:
        self.config = config
        self._model_loader = model_loader
        self._backend: TTSBackend | None = None
        self._executor: ThreadPoolExecutor | None = None
        self._slots = threading.BoundedSemaphore(config.queue_capacity)
        self._temp_paths: set[str] = set()
        self._temp_paths_lock = threading.Lock()
        self.ready = False

    def start(self) -> None:
        self._backend = self._model_loader(self.config)
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="coqui-synthesis")
        self.ready = True

    def shutdown(self) -> None:
        self.ready = False
        executor = self._executor
        self._executor = None
        if executor is not None:
            executor.shutdown(wait=True, cancel_futures=True)
        with self._temp_paths_lock:
            paths = list(self._temp_paths)
        for path in paths:
            self.cleanup_path(path)
        self._backend = None

    def voices(self) -> list[str]:
        backend = self._backend
        if backend is None:
            return []
        return discover_voices(backend, self.config.forced_voices)

    def tracked_temp_paths(self) -> tuple[str, ...]:
        with self._temp_paths_lock:
            return tuple(sorted(self._temp_paths))

    def cleanup_path(self, path: str) -> None:
        try:
            Path(path).unlink(missing_ok=True)
        finally:
            with self._temp_paths_lock:
                self._temp_paths.discard(path)

    def submit(self, text: str, voice: str | None) -> tuple[Future[str], str]:
        backend = self._backend
        executor = self._executor
        if not self.ready or backend is None or executor is None:
            raise RuntimeError("TTS backend is not ready")
        if not self._slots.acquire(blocking=False):
            raise OverflowError("Synthesis queue is full")

        descriptor, output_path = tempfile.mkstemp(suffix=".wav", prefix="chrome-readit-")
        os.close(descriptor)
        with self._temp_paths_lock:
            self._temp_paths.add(output_path)

        try:
            future = executor.submit(self._synthesize, backend, text, voice, output_path)
        except Exception:
            self._slots.release()
            self.cleanup_path(output_path)
            raise

        future.add_done_callback(lambda _future: self._slots.release())
        return future, output_path

    def _synthesize(
        self,
        backend: TTSBackend,
        text: str,
        voice: str | None,
        output_path: str,
    ) -> str:
        available_voices = discover_voices(backend, self.config.forced_voices)
        selected_voice: str | None = None
        if available_voices:
            selected_voice = voice or available_voices[0]
            if selected_voice not in available_voices:
                raise InvalidVoiceError(f"Voice '{selected_voice}' is not available")

        if selected_voice is None:
            backend.tts_to_file(text=text, file_path=output_path)
        else:
            backend.tts_to_file(text=text, file_path=output_path, speaker=selected_voice)

        output = Path(output_path)
        if not output.exists() or output.stat().st_size <= 0:
            raise RuntimeError("TTS backend produced an empty audio file")
        return output_path


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
        return JSONResponse(
            status_code=422,
            content=error_payload("INVALID_REQUEST", "The request body is invalid."),
        )

    @application.get("/api/ping")
    def ping() -> dict[str, bool]:
        return {"ok": True}

    @application.get("/api/ready")
    def ready() -> dict[str, bool]:
        if not runtime.ready:
            raise_api_error(503, "NOT_READY", "The TTS model is not ready.")
        return {"ok": True, "ready": True}

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
            raise_api_error(
                413,
                "TEXT_TOO_LONG",
                f"Text exceeds the {service_config.max_text_chars}-character limit.",
            )
        if not runtime.ready:
            raise_api_error(503, "NOT_READY", "The TTS model is not ready.")

        try:
            future, output_path = runtime.submit(text, request.voice)
        except OverflowError:
            raise_api_error(429, "QUEUE_FULL", "The synthesis queue is full.")
        except RuntimeError:
            raise_api_error(503, "NOT_READY", "The TTS model is not ready.")

        try:
            completed_path = future.result(timeout=service_config.synthesis_timeout_seconds)
        except FutureTimeoutError:
            future.add_done_callback(lambda _future: runtime.cleanup_path(output_path))
            raise_api_error(504, "SYNTHESIS_TIMEOUT", "Speech synthesis timed out.")
        except InvalidVoiceError as error:
            runtime.cleanup_path(output_path)
            raise_api_error(400, "INVALID_VOICE", str(error))
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
