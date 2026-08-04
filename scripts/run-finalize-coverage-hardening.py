from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FINALIZER = ROOT / "scripts" / "finalize-coverage-hardening.py"
WRAPPER = Path(__file__).resolve()

spec = importlib.util.spec_from_file_location("coverage_finalizer", FINALIZER)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load coverage finalizer")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def remove_only_non_workflow_helpers() -> None:
    FINALIZER.unlink()
    WRAPPER.unlink()


module.remove_temporary_files_and_restore_workflow = remove_only_non_workflow_helpers
module.main()
