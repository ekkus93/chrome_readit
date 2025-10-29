import tempfile
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import FileResponse

app = FastAPI(title="Coqui-local TTS")


class TTSRequest(BaseModel):
    text: str
    play_only: bool = False
    # optional fields left for future: voice, speaker, format


@app.on_event("startup")
def startup_event():
    # Lazy import / initialization — TTS may download models on first run
    global tts
    try:
        from TTS.api import TTS
    except Exception as e:
        raise RuntimeError("Failed to import TTS library: %s" % e)

    # Choose a compact CPU-friendly model by default; model will be downloaded on first run
    model_name = os.environ.get("COQUI_MODEL", "tts_models/en/ljspeech/tacotron2-DDC")
    tts = TTS(model_name)
    app.state.tts = tts


@app.post("/api/tts")
def synth(req: TTSRequest):
    tts = getattr(app.state, "tts", None)
    if tts is None:
        raise HTTPException(status_code=503, detail="TTS backend not initialized")

    # Create a temp file for output
    fd, out_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        # TTS.api.TTS provides tts_to_file that writes audio to disk
        tts.tts_to_file(text=req.text, file_path=out_path)
        # Optionally play the generated audio on the host's sound device.
        # This requires the container to have access to the host PulseAudio socket
        # (or /dev/snd) and paplay/aplay installed. Enable by setting
        # the environment variable PLAY_ON_HOST=1 in your docker-compose or
        # docker run environment.
        # If the caller explicitly requests server-side playback only, try to
        # play the generated WAV on the server and return a JSON status instead
        # of sending the file back. This makes the endpoint useful for remote
        # devices that should cause the server to read text aloud.
        if getattr(req, "play_only", False):
            # Launch playback in the background (non-blocking) and return
            # immediately so callers aren't blocked while audio plays.
            from subprocess import Popen
            try:
                if os.path.exists("/usr/bin/paplay"):
                    Popen(["/usr/bin/paplay", out_path])
                elif os.path.exists("/usr/bin/aplay"):
                    Popen(["/usr/bin/aplay", out_path])
                else:
                    # No local playback utility available
                    raise RuntimeError("No playback utility found (paplay or aplay)")
                return {"ok": True, "played": True}
            except Exception as e:
                # Surface the error to the client as a 500 so it can handle it
                # (e.g., for missing socket/permission issues).
                raise HTTPException(status_code=500, detail=str(e))

        # Otherwise behave as before: optionally spawn a non-blocking player if
        # the container is configured to do so (PLAY_ON_HOST), but still return
        # the generated file to the caller.
        try:
            play_on_host = os.environ.get("PLAY_ON_HOST", "0")
            if play_on_host.lower() in ("1", "true", "yes"):
                # Use paplay (PulseAudio) if available, otherwise fall back to aplay
                from subprocess import Popen
                if os.path.exists("/usr/bin/paplay"):
                    Popen(["/usr/bin/paplay", out_path])
                elif os.path.exists("/usr/bin/aplay"):
                    Popen(["/usr/bin/aplay", out_path])
        except Exception:
            # Don't fail the request if playback fails; continue to return the file
            pass
        return FileResponse(out_path, media_type="audio/wav", filename="speech.wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Caller will have received the file response; remove file asynchronously later if needed
        pass


@app.post("/api/tts/play")
def synth_play(req: TTSRequest):
    """Generate the WAV for the provided text and spawn playback on the
    server in the background (non-blocking). Returns JSON status immediately.
    This endpoint is explicitly for server-side playback; it does not return
    the audio file.
    """
    tts = getattr(app.state, "tts", None)
    if tts is None:
        raise HTTPException(status_code=503, detail="TTS backend not initialized")

    # Create a temp file for output
    fd, out_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        tts.tts_to_file(text=req.text, file_path=out_path)
        # Spawn playback in background and return immediately
        from subprocess import Popen
        try:
            if os.path.exists("/usr/bin/paplay"):
                Popen(["/usr/bin/paplay", out_path])
            elif os.path.exists("/usr/bin/aplay"):
                Popen(["/usr/bin/aplay", out_path])
            else:
                raise HTTPException(status_code=500, detail="No playback utility found (paplay or aplay)")
            return {"ok": True, "played": True}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Let the OS clean up the temporary file later; if you want aggressive
        # cleanup, implement a background cleanup task that deletes files after a
        # short delay.
        pass


@app.get("/api/ping")
def ping():
    return {"ok": True}
