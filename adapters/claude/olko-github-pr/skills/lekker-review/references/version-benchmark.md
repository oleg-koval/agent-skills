# Version benchmark: which release made bug detection worse?

Replays each release's own `workflow.js` over a fixed corpus of known-bug cases and compares
recall between releases. Scripts: `bench-corpus.mjs` (format), `bench-materialize.mjs`,
`bench-plan.mjs`, `bench-compare.mjs`, `bench-bisect.mjs`, all under `${SKILL_ROOT}/scripts/`.
The corpus lives outside the repo and is never committed.

## Plan

```
node "${SKILL_ROOT}/scripts/bench-plan.mjs" --arms v1.63.0,v1.67.0 --corpus <corpus.json> \
  --repeats 3 --depth medium --seed 1 --out <dir>
```

Writes `<dir>/plan.json` and prints the run count (arms x cases x repeats). The first arm is the
baseline. Each arm is a detached worktree under `${LEKKER_STATE_DIR}/bench/arms/<sha>`.
`plan.json` has `cases[].materialize` (an argv) and `rows[]` in shuffled run order, each with
`arm`, `sha`, `caseId`, `repeat`, `depth`, `scriptPath`, `args`, `resultPath`.

## Executor procedure (one session)

1. Run every case's `materialize` argv once. It creates the case input under `<dir>/cases/<id>/`.
2. For each row in `plan.json` order, make ONE Workflow tool call with `scriptPath=row.scriptPath`
   and `args=row.args`. Save the returned object as JSON to `row.resultPath` (create the
   directories). Do not edit, filter or retry-until-good a result.
3. Run `node "${SKILL_ROOT}/scripts/bench-compare.mjs" --plan <dir>/plan.json [--small-files]
   [--window N] [--json]`. It prints per-arm recall, a paired per-case table, a sign test and a
   verdict (`worse`, `better`, or `not distinguishable at N repeats`). Exit 1 means some planned
   runs have no result; finish them, a missing run is never a zero.

## Safety rules

- Never run `claude -p` with permissions bypassed. Use the Workflow tool in a normal session.
- No fix mode. Runs never push, post to GitHub, or touch the network for output.
- At most 2 Workflow runs at a time.
- State the run count and get an explicit go before the main run. Do not start it on your own.
- Case clones have no remote. If a run tries to write outside `<dir>`, stop.

## Smoke step (before the main run)

Plan 2 cases x 2 arms x 1 repeat at `--depth scan` (4 runs, for example `v1.63.0` and `v1.67.0`).
It confirms the old release accepts the args and returns `findings`. Fix the plan or args until
all 4 results parse; then ask for the go on the main run (for example 16 cases x 2 arms x 3
repeats at `medium` is 96 runs).

## Bisect

1. If the newer arm is `worse`, list candidate releases:
   `node "${SKILL_ROOT}/scripts/bench-bisect.mjs" --list` (tags that touch the skill path, oldest
   first; the first tag has no predecessor and is not listed).
2. Ask for the next ref: `node "${SKILL_ROOT}/scripts/bench-bisect.mjs" --tags <list> --good <ref>
   --bad <ref> [--verdicts <ref>=good,<ref>=bad]`. It prints `{"next": ref}`, `{"culprit": ref}`
   or an error (exit 1) for inconsistent verdicts.
3. Plan that ref against the baseline on the flipped cases only (a corpus file holding just those), run, compare, record the
   verdict, repeat step 2 until it prints a culprit (the first bad release).

## Control: the old version today

Re-run the old release now, next to the new one. If the old release also scores low today, the
cause is the model behind the alias, not a release, and the bisect is moot. Only a drop that the
old release does not show today points at a release.

## Not covered

The replay runs `workflow.js` only. It does not exercise:

- `SKILL.md` synthesis prose, for example moving findings to Pre-existing or the final merge of
  agent output. A full-skill run (`--no-fix`, explicit depth) launched by a human is needed.
- Post-workflow node scripts: `apply-review-rules.mjs` and `validate-lines.mjs`.
- Adjudicated scoring (`--defects`). Hits are location-only (same file, within the window), so
  read recall as an upper bound.
- Any model or alias change between runs on different days. Plan both arms in one session.
