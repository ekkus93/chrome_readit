from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


URL = "http://127.0.0.1:5002/api/ready"


def main() -> int:
    try:
        with urllib.request.urlopen(URL, timeout=4) as response:
            payload = json.load(response)
        return 0 if payload.get("ok") is True and payload.get("ready") is True else 1
    except urllib.error.HTTPError as error:
        try:
            payload = json.load(error)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return 1
        code = payload.get("error", {}).get("code") if isinstance(payload, dict) else None
        return 0 if error.code == 503 and code == "QUEUE_FULL" else 1
    except (OSError, ValueError):
        return 1


if __name__ == "__main__":
    sys.exit(main())
