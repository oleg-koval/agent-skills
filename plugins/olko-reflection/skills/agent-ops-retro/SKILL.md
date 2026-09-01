---
name: agent-ops-retro
description: >
  Retrospective on how the agents themselves are being operated, from local Claude Code
  transcripts plus the reports other jobs already produce. Answers what is going well, what is
  going wrong, what the human keeps having to repeat, and where delivery is leaking, then carries
  every unactioned finding forward with its age. USE THIS AUTOMATICALLY (no need for the user to
  name it) whenever the user asks to check all conversations, review agent usage, reduce the manual
  administration of agents, find repeating corrections or issues across sessions, audit skills and
  the knowledge ledger together, or asks what gaps exist in delivery over a recent window. This is
  the operator axis: for repository history and shipped work use retro-analysis, for a single
  finished change use wrap-up.
license: MIT
allowed-tools: Bash, Read, Write, Grep, Glob, Agent
compatibility: Claude Code. Reads ~/.claude transcripts and local report files, so it does not run on hosts without them.
metadata:
  author: Oleg Koval
  targets: [_source-only]
  tags:
    - retrospective
    - agent-operations
    - telemetry
    - skills
    - knowledge-ledger
    - delegation
    - cost
---

# Agent Ops Retro

A retrospective on the operating layer, not the code. It asks whether the agents are being run
well: what the human had to repeat, what the guardrails caught, what they cost, and which findings
have been reported before and never actioned.

## Scope boundary

Three retro skills exist and they do not overlap.

| Skill | Looks at | Answers |
|---|---|---|
| `retro-analysis` | Repository history, delivery evidence, code quality | What shipped and how the code is trending |
| `wrap-up` | One finished change | Did this specific piece of work meet its goal |
| `agent-ops-retro` | Transcripts, hooks, skills, ledger, delegation logs | How the agents are being operated |

If the user asks about shipped work, hand off to `retro-analysis` and say so.

## Invocation

Accept a window: `14d` (default), `7d`, `30d`, or an explicit ISO date range. State the absolute
range at the top of the output. Convert relative dates to absolute.

## Step 0. Read, do not recompute

Several jobs already report on this state. Adding a fifth independent opinion is the failure mode
this skill exists to fix, so read their outputs first and only compute what none of them cover.

| Source | Path | Gives you |
|---|---|---|
| Skill audit | `~/.claude/skill-audit/latest.json` and the dated `.txt` beside it | Installed vs never-invoked skills |
| Delegation log | `~/.claude/delegation-metrics/delegations.jsonl` | Model, tier, depth, outcome, rework per spawn |
| Tier check | `~/.claude/delegation-metrics/tier-check-*.md` | Opus share and spend against a baseline |
| Usage miner | `~/obsidian/cloud-opus/Lead/Automation/Weekly Automation Report *.md` | Repeated commands, proposal fatigue, approval queue |
| Miner state | `~/.claude/usage-miner/state/last-run.json` | What was staged, queued, blocked |
| Knowledge ledger | `~/.local/share/agent-context/repo/ledger.json` | Traps already recorded, so you do not re-derive them |
| Prior run | the previous output of this skill (see Step 6) | Findings to carry forward |

Two traps when reading these:

- A skill-usage figure counted from attributed messages is not an invocation count. The audit's own
  numbers run three orders of magnitude above the Skill-tool invocation count. Say which unit you
  are quoting, every time.
- When two sources disagree on the same number, report both with their sources and say the figure
  is unreconciled. Never silently pick one.

## Step 1. Mine the transcripts

This is the axis nothing else covers. Run `scripts/mine-transcripts.mjs` from this skill directory,
or reimplement it, over `~/.claude/projects/**/*.jsonl`.

Non-negotiable filters, each of which has burned a previous run:

- Filter by the record's own `.timestamp`, never by file mtime. A resumed session rewrites old
  files and pulls pre-window turns into the window.
- A `user` record is not a human turn. Exclude `tool_result` blocks, `<system-reminder>` wrappers,
  `<command-name>` and hook preambles, task notifications and bash echoes. In one measured corpus
  45 percent of `user` text records were tool echoes, so the raw count nearly doubles the real one.
- Exclude `isSidechain` records and anything under a `subagents/` directory from session and
  human-turn counts. Count them separately for the delegation view.
- Empty output is a state, not a success. If a scan returns nothing, prove the scan works before
  concluding the thing is absent.

Extract: organic human turns per day and per session, turn-length distribution, tool call counts,
`tool_result` errors with `is_error`, Agent spawns with `subagent_type` and `model`, Skill
invocations, interruptions, compaction events, per-model token usage including cache reads, and
synthetic records naming a rate or spend limit.

## Step 2. Classify what the human repeated

Group the organic turns. The strongest automation signal is not raw frequency, it is the number of
distinct sessions a correction appears in: a thing said twenty times in one session is one
argument, a thing said once in twenty sessions is a missing default.

Report each recurring pattern as: name, count, distinct sessions, two or three verbatim dated
quotes, and the one concrete change that removes it. Name the mechanism, not the mood. Write
"stops for a one-word ack on reversible steps", not "autonomy could be better".

## Step 3. Split what holds from what is broken

Produce two explicit lists, never a narrative.

**Verified as working:** the claim and what proved it. Guardrails that fired correctly count here.

**Defects:** the mechanism and its consequence. Include the governance frictions, which usually
outnumber the external failures: permission denials, classifier blocks, path-gate refusals, agent
output failing its own schema. Give each a count and a share of total errors.

## Step 4. Delivery leakage

Delivery here means whether agent output landed, not whether it was produced.

- Open PRs authored by the user, bucketed by age, with fan-out batches identified as batches.
- Tickets whose completion timestamps cluster in minutes, which is a status backfill rather than
  shipping. State both the raw completion count and the count after removing the cluster.
- Any fan-out with no named landing mechanism. That is backlog, not delivery.
- Scheduled jobs: check `launchctl list` exit codes and each job's own log. A wrapper exit code is
  not completion.

## Step 5. Close the knowledge circle

This is the half that makes the retro compound instead of repeating.

1. Before writing a finding, check whether the ledger already holds it:
   `~/.local/share/agent-context/repo/recipes/tools/ledger-index --kind trap --scope <scope>`.
   A finding the ledger already records is a compliance gap, not a discovery. Say which it is.
2. For each genuinely new, durable, cross-cutting trap, draft a note: `kind`, `scope`, `title`,
   `body`, and a `why` naming the concrete failure. A finding that is only true this week, or only
   true in one repository, does not go in the ledger. It goes in the report.
3. Appending is a shared write. Take the lease first
   (`recipes/tools/task-claim acquire ledger-append <agent> 20`), append without touching any
   existing note, run `node recipes/tools/validate-ledger.js`, assert the note count rose by
   exactly the number added and that no prior id vanished, commit, push, then verify
   `git rev-parse HEAD` against `git ls-remote origin main` and quote both. Release the lease even
   on failure.
4. Never append a credential, a personal path that is not the user's own machine, or a fact that is
   only true this week.

Present the drafted notes to the user and get an explicit go before pushing. The ledger is shared
with another agent, so an unrequested push is an external side effect.

## Step 6. Carry findings forward

The reason four correct reports changed nothing is that each one started clean. This skill does
not.

Write the output to a dated file and, on every run, read the previous one. Each finding carries:

- `first_seen`: the date it was first reported
- `runs_seen`: how many consecutive runs have reported it
- `status`: `new`, `carried`, `actioned`, or `closed-not-possible`

A finding at `runs_seen: 3` or more gets its own section at the top of the report titled with its
age, for example "Open for 3 runs". Reporting the same defect a fourth time without escalating it
is the failure this section prevents. `closed-not-possible` is a real terminal state and must
record why, so it is not rediscovered.

Use `context-repo` to resolve a durable private store for the snapshots if one is not already
configured. Do not write snapshots to a repo-local scratch directory.

## Step 7. Output

Lead with a verdict in one line naming what is wrong, not what was analysed. Then, in this order:

1. Open for N runs (carried findings, oldest first) - omit the section on a first run
2. Verified as working
3. Defects
4. What repeated, ranked by distinct sessions
5. Delivery leakage
6. Skills and knowledge, including the ledger notes drafted this run
7. The ranked change list, config edits before projects
8. Receipts

Hard rules for the output:

- Numbers over adjectives. "1120 organic turns, 46 percent under 40 characters" beats "a lot of
  short prompts".
- No em dashes anywhere. Hyphens or restructure.
- Every PR, issue or ticket line carries a clickable URL.
- Anything not run is named as not run. A step that was blocked is stated as blocked, with the
  reason and what remains untrue because of it.
- Receipts are facts with values: paths, counts, SHAs, exit codes, what was deliberately not run.

## Cost

Mining is grunt work. Run the extraction and the per-axis analysis as parallel leaf agents on
Sonnet or Haiku, and keep only the synthesis and the ledger decision on the session model. Pass the
agents the mined JSON paths rather than the transcripts, and require each to return its full report
in its final message: a subagent's transcript is not visible to the caller, and a report that says
"see above" arrives empty.
