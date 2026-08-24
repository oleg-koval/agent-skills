# Codex Adapter for wrap-up

This is the Codex-specific adapter for the `olko:wrap-up` skill. The canonical workflow is in
`../../SKILL.md`.

## Usage

Invoke it manually or after a completed task:

```text
Use the olko:wrap-up skill to verify the completed task, clean task-owned artifacts, and report the delivery receipt.
```

For Codex, keep the receipt fields required by the agent operating contract and treat local correctness,
remote state, PR state, CI, deployment, and human/device QA as separate gates. Use `git worktree list`
before removing worktrees, preserve unrelated dirty files, and never claim completion from a local green
check alone.
