#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MARKER = "<!-- maintained by .github/workflows/real-coqui-validation.yml -->"
WORKFLOW_NAME = "Real Coqui Validation"
WORKFLOW_FILE = "real-coqui-validation.yml"


def gh_json(endpoint: str) -> Any:
    completed = subprocess.run(
        ["gh", "api", endpoint],
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(completed.stdout)


def is_current_attempt(repo: str, run_id: int, attempt: int) -> bool:
    latest = gh_json(
        f"repos/{repo}/actions/workflows/{WORKFLOW_FILE}/runs?branch=master&per_page=1"
    )
    runs = latest.get("workflow_runs") if isinstance(latest, dict) else None
    if not isinstance(runs, list) or not runs or not isinstance(runs[0], dict):
        raise RuntimeError("Latest real Coqui workflow lookup returned no valid run.")
    latest_run_id = runs[0].get("id")
    if latest_run_id != run_id:
        print(f"Skipping stale real Coqui run {run_id}; latest run is {latest_run_id}.")
        return False

    current = gh_json(f"repos/{repo}/actions/runs/{run_id}")
    current_attempt = int(current.get("run_attempt") or 1)
    if current_attempt != attempt:
        print(
            f"Skipping stale real Coqui attempt {attempt}; current attempt is {current_attempt}."
        )
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("in_progress", "completed"), required=True)
    parser.add_argument("--conclusion", default="pending")
    args = parser.parse_args()

    repo = os.environ["GITHUB_REPOSITORY"]
    run_id = int(os.environ["GITHUB_RUN_ID"])
    attempt = int(os.environ["GITHUB_RUN_ATTEMPT"])
    sha = os.environ["GITHUB_SHA"]
    issue_number = int(os.environ.get("REAL_COQUI_STATUS_ISSUE", "3"))

    if not is_current_attempt(repo, run_id, attempt):
        return

    conclusion = args.conclusion if args.phase == "completed" else "pending"
    observed = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    machine = {
        "schema_version": 1,
        "workflow": {
            "name": WORKFLOW_NAME,
            "run_id": run_id,
            "run_attempt": attempt,
            "head_sha": sha,
            "status": args.phase,
            "conclusion": conclusion,
            "run_url": f"https://github.com/{repo}/actions/runs/{run_id}",
        },
        "artifact_retention": "tagged-releases-only",
    }

    body = "\n".join(
        [
            MARKER,
            "# Latest Real Coqui Validation",
            "",
            f"- **Status:** `{args.phase}`",
            f"- **Conclusion:** `{conclusion}`",
            f"- **Run:** `{run_id}`",
            f"- **Attempt:** `{attempt}`",
            f"- **Commit:** `{sha}`",
            "- **Artifacts:** `not retained for non-tag runs`",
            f"- **Observed:** `{observed}`",
            "",
            "## Machine-readable status",
            "",
            "```json",
            json.dumps(machine, indent=2, sort_keys=True),
            "```",
            "",
            "This issue is overwritten by the durable real-model validation workflow. It is not a historical log.",
            "",
        ]
    )

    issue = gh_json(f"repos/{repo}/issues/{issue_number}")
    existing_body = issue.get("body") if isinstance(issue, dict) else None
    if not isinstance(existing_body, str) or not existing_body.startswith(MARKER):
        raise SystemExit("Runtime status issue ownership marker is missing.")

    patch_path = Path(os.environ["RUNNER_TEMP"]) / "real-coqui-status.json"
    patch_path.write_text(json.dumps({"body": body}), encoding="utf-8")
    subprocess.run(
        [
            "gh",
            "api",
            "--method",
            "PATCH",
            f"repos/{repo}/issues/{issue_number}",
            "--input",
            str(patch_path),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
