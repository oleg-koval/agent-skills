#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path

workflow = Path('.github/workflows/automerge.yml').read_text()

required_fragments = (
    "pull_request_review_comment:\n    types: [created, edited, deleted]",
    "schedule:\n    - cron: '*/10 * * * *'",
    "workflow_dispatch:",
    "pr-number:",
    "jobs:\n  discover:",
    "  retry:",
    "  manual:",
    "  automerge:",
    "group: automerge-${{ matrix.pr-number }}",
    "group: automerge-${{ inputs.pr-number }}",
    "steps.premerge.outputs.already-merged != 'true'",
    "merged_by=",
    "gh workflow run ci-release.yml",
)

for fragment in required_fragments:
    assert fragment in workflow, f'missing workflow contract: {fragment}'

assert workflow.count('oleg-koval/pr-automerge-github-action@39316e1ba4f70de3f1576da572866841578be442') == 3
assert 'oleg-koval/pr-automerge-github-action@v1' not in workflow
assert workflow.count('name: Record merge state before evaluation') == 3
assert workflow.count('name: Dispatch release after a newly completed merge') == 3
PY
