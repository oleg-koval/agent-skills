#!/usr/bin/env bash
set -eu

python3 - <<'PY'
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap

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
    "group: automerge-${{ github.event.pull_request.number || inputs.pr-number || github.run_id }}",
    "gh api --paginate",
    "jq -s 'add | map(.number)'",
    "steps.premerge.outputs.already-merged != 'true'",
    "merged_by=",
    "gh workflow run ci-release.yml",
)

for fragment in required_fragments:
    assert fragment in workflow, f'missing workflow contract: {fragment}'

assert workflow.count('oleg-koval/pr-automerge-github-action@39316e1ba4f70de3f1576da572866841578be442') == 3
assert 'oleg-koval/pr-automerge-github-action@v1' not in workflow


def job_block(name):
    match = re.search(rf'^  {name}:\n.*?(?=^  \S|\Z)', workflow, re.M | re.S)
    assert match, f'missing job: {name}'
    return match.group()


for job, pr_reference in (
    ('retry', 'matrix.pr-number'),
    ('manual', 'inputs.pr-number'),
    ('automerge', 'github.event.pull_request.number'),
):
    steps = re.split(r'^      - ', job_block(job), flags=re.M)[1:]
    premerge = [step for step in steps if step.startswith('name: Record merge state before evaluation\n')]
    dispatch = [step for step in steps if step.startswith('name: Dispatch release after a newly completed merge\n')]
    assert len(premerge) == len(dispatch) == 1, f'{job}: missing merge-state or dispatch step'
    assert '\n        id: premerge\n' in premerge[0], f'{job}: missing premerge reference'
    assert '--json mergedAt' in premerge[0], f'{job}: missing merge-state query'
    for value in ('true', 'false'):
        assert f'already-merged={value}' in premerge[0], f'{job}: missing premerge output {value}'
    assert "\n        if: steps.premerge.outputs.already-merged != 'true'\n" in dispatch[0], f'{job}: unguarded dispatch'
    for step in (premerge[0], dispatch[0]):
        assert 'PR_NUMBER: ${{ ' + pr_reference + ' }}' in step, f'{job}: mismatched PR reference'
    action_index = next(i for i, step in enumerate(steps) if step.startswith('uses: oleg-koval/pr-automerge-github-action@'))
    assert steps.index(premerge[0]) < action_index < steps.index(dispatch[0]), f'{job}: incorrect merge-state ordering'

manual_block = workflow.split('  manual:\n', 1)[1].split('  automerge:\n', 1)[0]
assert 'concurrency:' not in manual_block, 'manual retries must use the workflow-level PR lock only'
assert 'add | map(.number)' in workflow, 'scheduled discovery must aggregate all paginated API pages'
assert 'pr-number: ${{ fromJSON(needs.discover.outputs.pr-numbers) }}' in job_block('retry')
assert 'PR_NUMBERS: ${{ inputs.pr-numbers }}' in job_block('discover')

# Execute the actual discovery script against paginated fixtures and capture
# workflow dispatches locally, including batches replayed as workflow inputs.
discovery_script = textwrap.dedent(job_block('discover').split('        run: |\n', 1)[1])
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    gh = root / 'gh'
    gh.write_text(f'#!{sys.executable}\n' + textwrap.dedent('''\
        import json
        import os
        from pathlib import Path
        import sys

        with Path(os.environ['GH_CALLS']).open('a') as log:
            log.write(json.dumps(sys.argv[1:]) + '\\n')
        if sys.argv[1] == 'api':
            print(Path(os.environ['GH_PAGES']).read_text())
    '''))
    gh.chmod(0o755)

    def discover(numbers, batch_input=''):
        pages = [numbers[i:i + 100] for i in range(0, len(numbers), 100)] or [[]]
        (root / 'pages').write_text('\n'.join(json.dumps([{'number': n} for n in page]) for page in pages))
        (root / 'calls').write_text('')
        (root / 'output').write_text('')
        subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', discovery_script], check=True, env={
            **os.environ,
            'BASH_ENV': '/dev/null',
            'PATH': f'{root}:{os.environ["PATH"]}',
            'PR_NUMBERS': batch_input,
            'GITHUB_REPOSITORY': 'test/repo',
            'GITHUB_REF_NAME': 'test-ref',
            'GITHUB_OUTPUT': str(root / 'output'),
            'GH_PAGES': str(root / 'pages'),
            'GH_CALLS': str(root / 'calls'),
        })
        output_lines = (root / 'output').read_text().splitlines()
        assert len(output_lines) == 1, 'matrix output must be compact single-line JSON'
        assert output_lines[0].startswith('pr-numbers=')
        matrix = json.loads(output_lines[0].split('=', 1)[1])
        calls = [json.loads(line) for line in (root / 'calls').read_text().splitlines()]
        return matrix, calls

    for count in (0, 1, 255, 256, 257, 512, 513, 1000):
        numbers = list(range(1, count + 1))
        matrix, calls = discover(numbers)
        assert calls[0] == ['api', '--paginate', 'repos/test/repo/pulls?state=open&per_page=100']
        batches = [matrix]
        for call in calls[1:]:
            assert call[:-1] == ['workflow', 'run', 'automerge.yml', '--repo', 'test/repo', '--ref', 'test-ref', '-f']
            assert call[-1].startswith('pr-numbers=')
            batch_input = call[-1].split('=', 1)[1]
            batch, replay_calls = discover([], batch_input)
            assert replay_calls == [], 'batch retries must not rediscover or redispatch PRs'
            assert batch, 'must not dispatch empty batches'
            batches.append(batch)
        assert all(len(batch) <= 256 for batch in batches), f'{count}: matrix limit exceeded'
        assert [number for batch in batches for number in batch] == numbers, f'{count}: lost or duplicated PRs'
PY
