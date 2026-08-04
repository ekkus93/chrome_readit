from pathlib import Path
import subprocess

script_path = Path(__file__)
previous = subprocess.run(
    ['git', 'show', f'HEAD^:{script_path.as_posix()}'],
    check=True,
    capture_output=True,
    text=True,
).stdout
old = """def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)
"""
new = """def replace_once(text: str, old: str, new: str, label: str) -> str:
    expected = 2 if label == 'TODO top SHA' else 1
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{label}: expected {expected} match(es), found {count}')
    return text.replace(old, new, expected)
"""
if previous.count(old) != 1:
    raise SystemExit('reconciler helper definition did not match exactly once')
patched = previous.replace(old, new, 1)
exec(compile(patched, str(script_path), 'exec'), {'__file__': str(script_path)})
