#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MARKER = "<!-- maintained by .github/workflows/real-coqui-validation.yml -->"
WORKFLOW_NAME = "Real Coqui Validation"


def gh_json(endpoint: str) -> Any:
    completed = subprocess.run(
        ["gh", "api", endpoint],
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(completed.stdout)


def artifact_for_run(repo: str, run_id: int, artifact_name: str) -> dict[str, Any] | None:
    for _ in range(6):
        payload = gh_json(f"repos/{repo}/actions/runs/{run_id}/artifacts?per_page=100")
        artifacts = payload.get("artifacts") if isinstance(payload, dict) else None
        if isinstance(artifacts, list):
            artifact = next(
                (
                    item
                    for item in artifacts
                    if isinstance(item, dict) and item.get("name") == artifact_name
                ),
                None,
            )
            if artifact is not None:
                return artifact
        time.sleep(2)
    return None


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
    artifact_name = f"real-coqui-{run_id}-{attempt}"
    artifact = (
        artifact_for_run(repo, run_id, artifact_name)
        if args.phase == "completed"
        else None
    )

    artifact_id = artifact.get("id") if artifact else None
    artifact_digest = artifact.get("digest") if artifact else None
    artifact_size = artifact.get("size_in_bytes") if artifact else None
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
        "artifact": {
            "name": artifact_name,
            "id": artifact_id,
            "digest": artifact_digest,
            "size_in_bytes": artifact_size,
        },
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
            f"- **Artifact:** `{artifact_name}`",
            f"- **Artifact ID:** `{artifact_id if artifact_id is not None else 'pending'}`",
            f"- **Artifact digest:** `{artifact_digest if artifact_digest is not None else 'pending'}`",
            f"- **Artifact bytes:** `{artifact_size if artifact_size is not None else 'pending'}`",
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
