from fastapi import FastAPI, Request, Response
import io
import soundfile as sf
import numpy as np
import tempfile
import os
from subprocess import Popen

app = FastAPI()

try:
    # Load a default Coqui TTS model. This may download model files on first run.
    from TTS.api import TTS
    tts = TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC", progress_bar=False, gpu=False)
except Exception as e:
    tts = None
    print("TTS model load failed; ensure models are available or network access allowed.", e)


@app.get("/ping")
async def ping():
    return {"ok": True}


@app.post("/api/tts")
async def synth(req: Request):
    data = await req.json()
    text = data.get("text") if isinstance(data, dict) else None
    if not text:
        return Response(status_code=400, content=b'{"error":"missing text"}', media_type="application/json")
    if tts is None:
        return Response(status_code=503, content=b'{"error":"TTS model not loaded"}', media_type="application/json")

    # tts.tts may return (wav, sr) tuple or numpy array depending on version
    try:
        out = tts.tts(text)
        if isinstance(out, tuple) and len(out) == 2:
            audio, sr = out
        else:
            audio = out
            sr = 22050
        # ensure numpy array
        audio = np.array(audio)
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV")
        return Response(content=buf.getvalue(), media_type="audio/wav")
    except Exception as e:
        return Response(status_code=500, content=(f'{{"error":"{str(e)}"}}').encode(), media_type="application/json")


@app.post("/api/tts/play")
async def synth_play(req: Request):
    data = await req.json()
    text = data.get("text") if isinstance(data, dict) else None
    if not text:
        return Response(status_code=400, content=b'{"error":"missing text"}', media_type="application/json")
    if tts is None:
        return Response(status_code=503, content=b'{"error":"TTS model not loaded"}', media_type="application/json")

    try:
        out = tts.tts(text)
        if isinstance(out, tuple) and len(out) == 2:
            audio, sr = out
        else:
            audio = out
            sr = 22050
        audio = np.array(audio)

        # Write to a temporary WAV file and spawn playback in background
        fd, out_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            buf = io.BytesIO()
            sf.write(buf, audio, sr, format="WAV")
            with open(out_path, "wb") as f:
                f.write(buf.getvalue())

            # Spawn paplay or aplay in background
            if os.path.exists("/usr/bin/paplay"):
                Popen(["/usr/bin/paplay", out_path])
            elif os.path.exists("/usr/bin/aplay"):
                Popen(["/usr/bin/aplay", out_path])
            else:
                return Response(status_code=500, content=b'{"error":"no playback utility (paplay/aplay)"}', media_type="application/json")

            return Response(content=b'{"ok": true, "played": true}', media_type="application/json")
        finally:
            # Do not immediately delete the file; let the player read it. The
            # OS will reclaim temp files eventually. For aggressive cleanup,
            # implement background deletion after a delay.
            pass
    except Exception as e:
        return Response(status_code=500, content=(f'{{"error":"{str(e)}"}}').encode(), media_type="application/json")
