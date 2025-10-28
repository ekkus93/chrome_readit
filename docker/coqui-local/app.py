import tempfile
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import FileResponse

app = FastAPI(title="Coqui-local TTS")


class TTSRequest(BaseModel):
    text: str
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
        return FileResponse(out_path, media_type="audio/wav", filename="speech.wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Caller will have received the file response; remove file asynchronously later if needed
        pass


@app.get("/api/ping")
def ping():
    return {"ok": True}
