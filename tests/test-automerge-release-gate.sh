#!/bin/sh
set -eu

python3 - <<'PY'
from pathlib import Path

workflow = Path('.github/workflows/automerge.yml').read_text()
action = 'oleg-koval/pr-automerge-github-action@39316e1ba4f70de3f1576da572866841578be442'
action_offset = workflow.index(action)
gate_offset = workflow.index("if: steps.premerge.outputs.already-merged != 'true'")
dispatch_offset = workflow.index('gh workflow run ci-release.yml')

assert workflow.count('name: Record merge state before evaluation') == 1
assert workflow.count('--json mergedAt') == 1
assert action_offset < gate_offset < dispatch_offset
assert 'name: Dispatch release after a newly completed merge' in workflow
PY