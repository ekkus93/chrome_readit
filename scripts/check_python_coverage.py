#!/usr/bin/env python3
"""Fail-closed checker for Chrome Read It's Coqui runtime coverage report."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

STATEMENTS_MINIMUM = 85.0
BRANCHES_MINIMUM = 75.0
REQUIRED_RUNTIME_FILES = (
    "docker/coqui-local/app.py",
    "docker/coqui-local/healthcheck.py",
)


class CoveragePolicyError(RuntimeError):
    """Raised when a coverage report is missing, malformed, or below policy."""


def _finite_percentage(value: object, label: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise CoveragePolicyError(f"{label} is missing or is not numeric")
    percentage = float(value)
    if not math.isfinite(percentage) or percentage < 0 or percentage > 100:
        raise CoveragePolicyError(f"{label} is outside the valid 0..100 range")
    return percentage


def load_summary(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise CoveragePolicyError(f"Python coverage report is missing: {path}")
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CoveragePolicyError(f"Python coverage report is unreadable or malformed: {path}") from error
    if not isinstance(report, dict):
        raise CoveragePolicyError("Python coverage report root must be an object")
    totals = report.get("totals")
    files = report.get("files")
    if not isinstance(totals, dict) or not isinstance(files, dict):
        raise CoveragePolicyError("Python coverage report must contain totals and files objects")
    missing_files = [runtime_file for runtime_file in REQUIRED_RUNTIME_FILES if runtime_file not in files]
    if missing_files:
        raise CoveragePolicyError(f"Python coverage report is missing runtime files: {', '.join(missing_files)}")
    return report


def evaluate(path: Path) -> dict[str, float]:
    report = load_summary(path)
    totals = report["totals"]
    statements = _finite_percentage(totals.get("percent_statements_covered"), "statement coverage")
    branches = _finite_percentage(totals.get("percent_branches_covered"), "branch coverage")
    failures: list[str] = []
    if statements < STATEMENTS_MINIMUM:
        failures.append(f"statements {statements:.2f}% < {STATEMENTS_MINIMUM:.2f}%")
    if branches < BRANCHES_MINIMUM:
        failures.append(f"branches {branches:.2f}% < {BRANCHES_MINIMUM:.2f}%")
    if failures:
        raise CoveragePolicyError("Python coverage threshold failure: " + "; ".join(failures))
    return {"statements": statements, "branches": branches}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", nargs="?", default="reports/coqui-coverage.json")
    args = parser.parse_args()
    try:
        summary = evaluate(Path(args.report))
    except CoveragePolicyError as error:
        print(f"Python coverage policy failure: {error}")
        return 1
    print("Python runtime coverage:")
    print(f"- statements: {summary['statements']:.2f}% (minimum {STATEMENTS_MINIMUM:.2f}%)")
    print(f"- branches: {summary['branches']:.2f}% (minimum {BRANCHES_MINIMUM:.2f}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
