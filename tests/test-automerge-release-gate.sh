#!/bin/sh
set -eu

python3 - <<'PY'
import re
from pathlib import Path

workflow = Path('.github/workflows/automerge.yml').read_text()
pin = 'oleg-koval/pr-automerge-github-action@39316e1ba4f70de3f1576da572866841578be442'

assert workflow.count('name: Record merge state before evaluation') == 3
assert workflow.count('name: Dispatch release after a newly completed merge') == 3
assert workflow.count("if: steps.premerge.outputs.should-dispatch == 'true'") == 3
assert workflow.count('--json mergedAt') == 3
assert workflow.count('set -euo pipefail') == 7
assert workflow.count(pin) == 3

for job in ('retry', 'manual', 'automerge'):
    match = re.search(rf'^  {job}:\n.*?(?=^  \S|\Z)', workflow, re.M | re.S)
    assert match, f'missing job: {job}'
    block = match.group()
    premerge = block.index('name: Record merge state before evaluation')
    action = block.index('uses: ' + pin)
    dispatch = block.index('name: Dispatch release after a newly completed merge')
    guard = block.index("if: steps.premerge.outputs.should-dispatch == 'true'")
    assert premerge < action < dispatch < guard, f'{job}: incorrect merge-gate ordering'
    dispatch_step = block[dispatch:]
    assert 'gh run list' in dispatch_step
    assert 'gh workflow run ci-release.yml' in dispatch_step
    assert 'RELEASE_PENDING_LABEL' in dispatch_step
PY
