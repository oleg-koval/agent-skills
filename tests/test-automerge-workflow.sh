#!/usr/bin/env bash
set -eu

python3 - <<'PY'
import json
import os
import re
import subprocess
import tempfile
import textwrap
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
    "jq -s -c 'add | map(select(.pull_request != null) | .number)'",
    "for ((offset = 256; offset < total; offset += 256))",
    "gh workflow run automerge.yml",
    "set -euo pipefail",
    '"repos/$GITHUB_REPOSITORY/actions/workflows/ci-release.yml/runs"',
    "-f \"release-key=$merge_sha\"",
)
for fragment in required_fragments:
    assert fragment in workflow, f'missing workflow contract: {fragment}'

pin = 'oleg-koval/pr-automerge-github-action@39316e1ba4f70de3f1576da572866841578be442'
assert workflow.count(pin) == 3
assert 'oleg-koval/pr-automerge-github-action@v1' not in workflow
assert workflow.count('name: Record merge state before evaluation') == 3
assert workflow.count('name: Dispatch release after a newly completed merge') == 3



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
    assert "\n        if: steps.premerge.outputs.should-dispatch == 'true'\n" in dispatch[0], \
        f'{job}: dispatch is not guarded by this job’s premerge state'
    assert 'steps.premerge.outputs.should-dispatch' in dispatch[0]
    assert 'RELEASE_PENDING_LABEL' in dispatch[0]
    assert 'gh api --paginate --method GET' in dispatch[0]
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


def run_scripts(job: str) -> list[str]:
    return [textwrap.dedent(script) for script in re.findall(
        r'^        run: \|\n((?:^          .*\n|^\n)*)', job_block(job), re.M
    )]


# Execute the workflow's Bash and jq with paginated, synthetic API responses.
def run_step(script: str, fixtures: dict) -> tuple[str, list]:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        mock = root / 'gh'
        mock.write_text('''#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
with open(os.environ['MOCK_CALLS'], 'a') as calls:
    calls.write(json.dumps(args) + '\\n')
fixtures = json.loads(os.environ['MOCK_FIXTURES'])
if args[:2] == ['pr', 'view']:
    print(json.dumps(fixtures['pr']))
elif args[0] == 'api':
    assert '--paginate' in args, args
    endpoint = next(arg for arg in args if arg.startswith('repos/'))
    if '/pulls?' in endpoint:
        pages = fixtures['open']
    elif '/issues?' in endpoint:
        pages = fixtures['pending']
    else:
        assert endpoint == 'repos/example/repo/actions/workflows/ci-release.yml/runs', args
        assert args[args.index('--method') + 1] == 'GET', args
        for field in ('event=workflow_dispatch', 'branch=release/test', 'per_page=100'):
            assert field in args, args
        pages = fixtures['runs']
    for page in pages:
        print(json.dumps(page))
elif args[:2] not in (['label', 'create'], ['pr', 'edit'], ['workflow', 'run']):
    raise AssertionError(args)
''')
        mock.chmod(0o755)
        calls_path = root / 'calls'
        output_path = root / 'output'
        env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}', BASH_ENV='',
                   MOCK_FIXTURES=json.dumps(fixtures), MOCK_CALLS=str(calls_path),
                   GITHUB_REPOSITORY='example/repo', GITHUB_OUTPUT=str(output_path),
                   PR_NUMBERS='', PR_NUMBER='42', DEFAULT_REF='main',
                   RELEASE_PENDING_LABEL='release-dispatch-pending')
        result = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        return (output_path.read_text() if output_path.exists() else '',
                [json.loads(line) for line in calls_path.read_text().splitlines()])


for job in ('discover', 'retry', 'manual', 'automerge'):
    for script in run_scripts(job):
        subprocess.run(['bash', '-n'], input=script, text=True, check=True)

logins = re.search(r'bot-logins: (.+)', workflow).group(1).split(',')
assert workflow.count('bot-logins: ' + ','.join(logins)) == 3
open_prs = [
    {'number': number, 'draft': draft, 'user': {'login': login}}
    for number, (login, draft) in enumerate(
        [(login, False) for login in logins] + [(login, True) for login in logins] +
        [('unlisted-user', False), ('unlisted-user', True)], start=1
    )
]
output, _ = run_step(run_scripts('discover')[0], {
    'open': [open_prs[:3], open_prs[3:]],
    'pending': [[{'number': 1, 'pull_request': {}}, {'number': 99}],
                [{'number': 42, 'state': 'closed', 'pull_request': {'merged_at': '2026-10-17'}}]],
})
assert json.loads(output.removeprefix('pr-numbers=')) == [1, 2, 3, 4, 42], output

# A discovery list over the matrix limit must fan out without dropping or
# duplicating any PR: one 256-job matrix plus another dispatched batch.
large_open_prs = [
    {'number': number, 'draft': False, 'user': {'login': 'oleg-koval'}}
    for number in range(1, 258)
]
output, calls = run_step(run_scripts('discover')[0], {
    'open': [large_open_prs],
    'pending': [[]],
})
first_batch = json.loads(output.removeprefix('pr-numbers='))
batch_dispatches = [call for call in calls if call[:3] == ['workflow', 'run', 'automerge.yml']]
assert len(first_batch) == 256, len(first_batch)
assert json.loads(next(arg.split('=', 1)[1] for arg in batch_dispatches[0] if arg.startswith('pr-numbers='))) == [257]
assert len(batch_dispatches) == 1, batch_dispatches

pr = {'baseRefName': 'release/test', 'mergedAt': '2026-10-17',
      'mergeCommit': {'oid': 'merge-sha'}, 'mergedBy': {'login': 'app/github-actions'}}
other_runs = [{'display_title': 'CI and release (other-sha)'} for _ in range(100)]
matching_run = {'display_title': 'CI and release (merge-sha)'}
for job in ('retry', 'manual', 'automerge'):
    for pages, should_dispatch in (
        ([{'workflow_runs': other_runs}, {'workflow_runs': [matching_run]}], False),
        ([{'workflow_runs': [matching_run]}, {'workflow_runs': [matching_run]}], False),
        ([{'workflow_runs': other_runs}, {'workflow_runs': []}], True),
        ([{'workflow_runs': []}], True),
    ):
        _, calls = run_step(run_scripts(job)[-1], {'pr': pr, 'runs': pages})
        dispatches = [call for call in calls if call[:3] == ['workflow', 'run', 'ci-release.yml']]
        assert len(dispatches) == int(should_dispatch), (job, calls)
        if should_dispatch:
            assert 'release-key=merge-sha' in dispatches[0], dispatches
        assert calls[-1][-2:] == ['--remove-label', 'release-dispatch-pending'], calls
PY
