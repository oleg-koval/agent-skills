# Where a run leaves traces

One table, so nobody has to rediscover this. The run log is the index: it
points at, and copies the numbers out of, everything else.

| Trace | Path | Written by | Kept | What it answers |
|---|---|---|---|---|
| Run ledger | `~/.local/state/lekker-review/runs.jsonl` | `scripts/run-log.mjs finish`, `backfill` | forever (one line per run) | how long, how many tokens, findings, drops, proofs, verdict, per engine and depth |
| Run archive | `~/.local/state/lekker-review/runs/<runId>/` | `run-log.mjs start/mark/attach/finish` | 90 days (`prune`) | `run.json` with timeline, plus the run's `findings.json`, `worktree.json`, `preflight.json`, `context.json` |
| Dependency ledger | `~/.local/state/lekker-review/deps.json` | `scripts/deps.mjs` | forever | which optional tools were installed or skipped, versions, last upstream check |
| Review report | `~/code-reviews/<date>-<target>-<repo>.md` | Step 3 | forever | the review as printed, including the `Review Cost` block |
| revmux archive | `~/code-reviews/revmux-tasks/<task>/<NN-run>/` | revmux, plus `revmux.stderr.log` from `scripts/revmux-engine.sh` | forever, never edit | `events.jsonl` (agent start, degraded, retried), `agents/*.jsonl` (per-agent cost and usage), `revmux.stderr.log` (why a round degraded; rounds before 2026-10-20 have none) |
| Harness workflow record | `~/.claude/projects/*/<session>/workflows/wf_*.json` | Claude Code Workflow tool | until Claude Code cleans the session | the source `finish` copies from: `durationMs`, `totalTokens`, `agentCount`, `result` |
| Cache | `~/.cache/lekker-review/` | Steps 1, 3, 5 | disposable | `reviewed/<sha>` branch-mode markers, `bot-precision.jsonl`, `repo-map.tsv` |
| Pattern memory | ICM (`icm recall`) | Step 5 housekeeping | ICM decay | recurring review and false-positive patterns per repo |

`LEKKER_STATE_DIR` moves the state root (tests use it). `LEKKER_CLAUDE_PROJECTS`
and `LEKKER_REVMUX_TASKS_DIR` point `run-log.mjs` at other harness and revmux
roots.

## Reading it

```bash
node ${SKILL_ROOT}/scripts/run-log.mjs report --days 30         # table
node ${SKILL_ROOT}/scripts/run-log.mjs report --days 90 --json  # for scripts
jq -c 'select(.verdict=="needs-work")' ~/.local/state/lekker-review/runs.jsonl   # ad hoc
```

`report` keeps the newest row per `runId`, so a run finished twice (review,
then fix) counts once. Rows with `source: harness-backfill` or
`revmux-backfill` were imported from history and have no timeline or verdict.

## Known gaps

- Backfilled harness rows cannot tell which review fell back from revmux to the
  workflow engine; new runs record the engine at `start`.
- revmux tokens include cache reads, workflow `totalTokens` does not break them
  out. Compare cost in dollars or wall time, not raw tokens, across engines.
- Verdict and severity counts exist only for runs logged with `finish`.
