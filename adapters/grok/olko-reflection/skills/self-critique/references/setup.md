# Setup notes

## Standalone Cursor installation

Use the generated Cursor adapter or the full skill package, including its `scripts/` and
`references/` directories. Copying only `SKILL.md` is insufficient for this workflow, which calls
the bundled scripts.

## State directory

Each run writes to its own dated folder, outside any repository:

- root: `$SELF_CRITIQUE_STATE_DIR`, else `${XDG_STATE_HOME:-~/.local/state}/self-critique`
- per project: a folder named from the working directory, then one folder per run named from a UTC
  timestamp (`2026-11-19T21-09-27`, with `-1`, `-2` on a same-second collision), mode 0700

```bash
RUN=$(node <skill>/scripts/run-store.mjs new --cwd "$PWD")      # create and print the run folder
node <skill>/scripts/run-store.mjs latest --cwd "$PWD"          # newest run folder
node <skill>/scripts/run-store.mjs history --cwd "$PWD" --limit 10   # first-answer score trend
```

A run folder holds `run.json`, `author-claims.json`, `critic-r<N>.json` and `ledger-v<N>.json`.
Ledgers contain candidate claim text, so keep them out of the repository tree.

## Optional: auto-offer via a Claude Code Stop hook

A hook is a shell command, so it cannot run this loop itself. What it can do is **nudge**: after a
substantial answer, it offers the review and you run the skill only if the user says yes.

The hook ships with this skill at `scripts/critique-nudge.mjs`. Register it as a `Stop` hook in your
Claude Code settings (`.claude/settings.json` for a team, `.claude/settings.local.json` for
yourself):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/critique-nudge.mjs\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

Copy `scripts/critique-nudge.mjs` to `.claude/hooks/critique-nudge.mjs` (or point the command at
wherever you keep it). After an answer whose final prose is at least 1500 characters, the hook blocks
the turn once and instructs the agent to append a one-line "critical-thinking review" offer, then
stop. Two loop guards keep it from firing forever: it does nothing when `stop_hook_active` is set, and
nothing when the answer already contains the offer phrase. On any malformed input it exits silently
and never blocks the user.

The 1500-character threshold is a heuristic with a known ceiling: it misses short but dense
tool-heavy turns. If that matters, extend the script to also count tool calls since the last user
message.
