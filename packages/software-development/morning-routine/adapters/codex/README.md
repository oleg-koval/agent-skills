# Codex Adapter for morning-routine

This is a Codex-specific adapter for the `olko:morning-routine` skill.
The canonical skill definition is in `../../SKILL.md`.

## Usage

Invoke in a Codex session:

```text
Use the olko:morning-routine skill to run my start-of-day setup.
```

## Workflow

See `../../SKILL.md` for the full workflow: roll over unfinished tasks from the previous
workday's Obsidian daily note to today's, sync open GitHub PRs that need your attention,
and sweep Dependabot/Renovate PRs for safe patch merges. Chains obsidian-task-rollover,
obsidian-pr-sync, and dependabot-triage. The procedure is agent-agnostic.
