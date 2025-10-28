from fastapi import FastAPI, Request, Response
import io
import soundfile as sf
import numpy as np

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
