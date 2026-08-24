# Codex adapter: retro-analysis

Use this adapter when the user asks for a retrospective, trend review, “what did we ship?”, recurring engineering analysis, or a cross-project/global retro.

Invoke it as `olko:retro-analysis` with `24h`, `7d`, `14d`, `30d`, `compare`, `compare 14d`, or `global [window]`. Resolve calendar windows in the user's local timezone and state the exact scope before analyzing it.

Codex-specific defaults:

- Use repository Git evidence and `gh` provider evidence when available; keep local, remote, PR, CI, deployment, and device/human QA claims separate.
- Inspect the repository's existing scripts and instructions before running checks. For Node projects, use the project's `npm run` scripts rather than raw `node` commands.
- Preserve dirty worktrees and unrelated artifacts. Do not fetch, push, merge, deploy, delete branches, or clean temporary files as a side effect of analysis.
- Treat unavailable or stale provider/session data as a limitation, not as a zero or a green result.
- Write only the bounded `.context/retros/` snapshot described by the canonical skill when persistence is in scope; never include secrets or raw private session content.
- If the retrospective closes a completed implementation, follow it with `olko:wrap-up` for the delivery receipt and task-owned cleanup.

Return the full narrative report followed by the canonical `RETRO_STATUS` block. Do not convert the report into a delivery claim unless `olko:wrap-up` has separately verified delivery.
