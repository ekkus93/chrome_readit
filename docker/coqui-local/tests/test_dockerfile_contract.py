from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = ROOT / "docker" / "coqui-local" / "Dockerfile"


def test_runtime_image_installs_queue_aware_healthcheck() -> None:
    text = DOCKERFILE.read_text()

    assert "COPY --chown=readit:readit app.py healthcheck.py README.md ./" in text
    assert "--start-period=15m" in text
    assert 'CMD ["python", "/app/healthcheck.py"]' in text
    assert "urllib.request.urlopen" not in text


def test_runtime_image_remains_non_root() -> None:
    text = DOCKERFILE.read_text()

    assert "useradd --create-home --uid 10001" in text
    assert "USER readit" in text
    assert 'CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5002", "--workers", "1", "--no-access-log"]' in text
