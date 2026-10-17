#!/usr/bin/env bash
set -eu

python3 - <<'PY'
import re
from pathlib import Path

workflow = Path('.github/workflows/automerge.yml').read_text()
release = Path('.github/workflows/ci-release.yml').read_text()

required_fragments = (
    "pull_request_target:\n    types: [opened, reopened, synchronize, ready_for_review, edited, closed]",
    "pull_request_review_comment:\n    types: [created, edited, deleted]",
    "schedule:\n    - cron: '*/10 * * * *'",
    "workflow_dispatch:",
    "pr-number:",
    "pr-numbers:",
    "RELEASE_PENDING_LABEL: release-dispatch-pending",
    "gh api --paginate",
    "jq -s -c 'add | map(.number)'",
    "jq -s -c 'add | map(select(.pull_request != null) | .number)'",
    "for ((offset = 256; offset < total; offset += 256))",
    "gh workflow run automerge.yml",
    "set -euo pipefail",
    "gh run list --repo \"$GITHUB_REPOSITORY\" --workflow ci-release.yml",
    "-f \"release-key=$merge_sha\"",
)
for fragment in required_fragments:
    assert fragment in workflow, f'missing workflow contract: {fragment}'

pin = 'oleg-koval/pr-automerge-github-action@39316e1ba4f70de3f1576da572866841578be442'
assert workflow.count(pin) == 3
assert 'oleg-koval/pr-automerge-github-action@v1' not in workflow
assert workflow.count('name: Record merge state before evaluation') == 3
assert workflow.count('name: Dispatch release after a newly completed merge') == 3
assert workflow.count("if: steps.premerge.outputs.should-dispatch == 'true'") == 3


def job_block(name: str) -> str:
    match = re.search(rf'^  {name}:\n.*?(?=^  \S|\Z)', workflow, re.M | re.S)
    assert match, f'missing job: {name}'
    return match.group()


for job, pr_reference in (
    ('retry', 'matrix.pr-number'),
    ('manual', 'inputs.pr-number'),
    ('automerge', 'github.event.pull_request.number'),
):
    block = job_block(job)
    steps = re.split(r'^      - ', block, flags=re.M)[1:]
    premerge = [step for step in steps if step.startswith('name: Record merge state before evaluation\n')]
    dispatch = [step for step in steps if step.startswith('name: Dispatch release after a newly completed merge\n')]
    assert len(premerge) == len(dispatch) == 1, f'{job}: missing merge-state or dispatch step'
    assert '\n        id: premerge\n' in premerge[0]
    assert '--json mergedAt' in premerge[0]
    assert 'should-dispatch=true' in premerge[0]
    assert 'should-dispatch=false' in premerge[0]
    assert "\n        if: steps.premerge.outputs.should-dispatch == 'true'\n" in dispatch[0]
    assert 'RELEASE_PENDING_LABEL' in dispatch[0]
    assert 'gh run list' in dispatch[0]
    assert 'gh workflow run ci-release.yml' in dispatch[0]
    assert 'PR_NUMBER: ${{ ' + pr_reference + ' }}' in premerge[0]
    assert 'PR_NUMBER: ${{ ' + pr_reference + ' }}' in dispatch[0]
    action_index = next(i for i, step in enumerate(steps) if step.startswith('uses: ' + pin))
    assert steps.index(premerge[0]) < action_index < steps.index(dispatch[0])

assert 'group: automerge-${{ matrix.pr-number }}' in job_block('retry')
manual_block = job_block('manual')
assert 'concurrency:' not in manual_block, 'manual retries must use only the workflow-level PR lock'
assert "jq -ce 'if type == \"array\"" in workflow, 'manual batches must be validated as JSON arrays'
assert 'release-dispatch-pending' in workflow, 'merged release state must be durable'

assert 'release-key:' in release
assert 'run-name: CI and release (${{ inputs.release-key || github.sha }})' in release
assert 'group: ci-release-${{ github.ref_name }}' in release
assert 'cancel-in-progress: false' in release
PY
