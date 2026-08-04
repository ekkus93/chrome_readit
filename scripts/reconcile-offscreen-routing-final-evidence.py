from pathlib import Path
import subprocess

script_path = Path(__file__).resolve()
relative_path = script_path.relative_to(Path.cwd()).as_posix()
source = subprocess.run(
    [
        'git',
        'show',
        f'33aaff97a052a7ba537620b19e5418f5600bf6ac:{relative_path}',
    ],
    check=True,
    capture_output=True,
    text=True,
).stdout

old_helper = """def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)
"""
new_helper = old_helper + """

def replace_first_of_two(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 2:
        raise SystemExit(f'{label}: expected two ordered matches, found {count}')
    return text.replace(old, new, 1)


def replace_exact_count(
    text: str,
    old: str,
    new: str,
    expected: int,
    label: str,
) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{label}: expected {expected} matches, found {count}')
    return text.replace(old, new, expected)
"""
if source.count(old_helper) != 1:
    raise SystemExit('reconciler helper definition did not match exactly once')
patched = source.replace(old_helper, new_helper, 1)

old_call = """todo = replace_once(todo,
    '**Validated implementation SHA:** `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`',
    '**Validated implementation SHA:** `740a86e2912615ba1b1868feb9709d82d78aafd6`',
    'TODO top SHA')"""
new_call = """todo = replace_first_of_two(todo,
    '**Validated implementation SHA:** `50c823c8c01b8ec4d556f21b9849aca3a77e59f4`',
    '**Validated implementation SHA:** `740a86e2912615ba1b1868feb9709d82d78aafd6`',
    'TODO top SHA')"""
if patched.count(old_call) != 1:
    raise SystemExit('ordered TODO SHA call did not match exactly once')
patched = patched.replace(old_call, new_call, 1)

old_artifact_loop = """for old, new in artifact_pairs:
    todo = replace_once(todo, old, new, f'TODO artifact {old}')"""
new_artifact_loop = """for old, new in artifact_pairs:
    if old == '8880131864':
        todo = replace_exact_count(
            todo,
            old,
            new,
            2,
            f'TODO artifact {old}',
        )
    else:
        todo = replace_once(todo, old, new, f'TODO artifact {old}')"""
if patched.count(old_artifact_loop) != 1:
    raise SystemExit('TODO artifact loop did not match exactly once')
patched = patched.replace(old_artifact_loop, new_artifact_loop, 1)

exec(compile(patched, str(script_path), 'exec'), {'__file__': str(script_path)})
