from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))

from check_python_coverage import CoveragePolicyError, evaluate  # noqa: E402


def report(statements: float = 90.0, branches: float = 80.0) -> dict[str, object]:
    return {
        "totals": {
            "percent_statements_covered": statements,
            "percent_branches_covered": branches,
        },
        "files": {
            "docker/coqui-local/app.py": {},
            "docker/coqui-local/healthcheck.py": {},
        },
    }


def write(tmp_path: Path, payload: object) -> Path:
    path = tmp_path / "coverage.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_accepts_runtime_report_at_or_above_threshold(tmp_path: Path) -> None:
    assert evaluate(write(tmp_path, report(85.0, 75.0))) == {"statements": 85.0, "branches": 75.0}


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({}, "totals and files"),
        (report(84.99, 80.0), "statements 84.99%"),
        (report(90.0, 74.99), "branches 74.99%"),
        ({**report(), "files": {"docker/coqui-local/app.py": {}}}, "healthcheck.py"),
    ],
)
def test_rejects_malformed_incomplete_or_below_threshold_reports(
    tmp_path: Path,
    payload: object,
    message: str,
) -> None:
    with pytest.raises(CoveragePolicyError, match=message):
        evaluate(write(tmp_path, payload))


def test_rejects_missing_and_invalid_json(tmp_path: Path) -> None:
    with pytest.raises(CoveragePolicyError, match="missing"):
        evaluate(tmp_path / "missing.json")
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{", encoding="utf-8")
    with pytest.raises(CoveragePolicyError, match="malformed"):
        evaluate(invalid)
