<!-- Managed by oleg-koval/fleet from oleg-koval/agents@2cef368851d831ebf91f48f7cde853353e6cd256 -->
# Charter pipeline

This pipeline applies only when the target repository has `.charter/rules.toml` and `.charter/checks.toml`. The target files are the contract; this document does not copy their rules. Charter's CLI and command behavior belong to the `oleg-koval/charter` project.

1. Read both files and the target repo's `AGENTS.md`. Identify the rules and checks relevant to the proposed diff; do not treat a past run as current evidence.
2. Treat contributor-controlled checks and their dependencies as untrusted code. Inspect their commands, scripts, configuration, and installation hooks before execution. When safety is not established, run them only in an isolated environment without credentials, secrets, sensitive files, host mounts, or ambient access. If that isolation is unavailable, report the checks as unavailable; do not execute them with agent access.
3. Run `charter doctor` with the target repo's configured directory. Fix missing mappings or report the explicit waiver and its reason.
4. Run `charter check` with the target's event and changed-base settings, plus every locally runnable CI check declared by that repo. Record the exact command and result.
5. For an independent review, use the target's review artifact and run `charter verify-review` when configured. Verify each actionable finding against the final diff.
6. Prepare the PR body from the target template and run `charter verify-pr` when configured. Preserve its required sections.
7. After a push, read the exact remote head and Charter CI job. A local pass and a queued or unavailable remote job are different states.

Do not silently edit a shared rule to make a check pass, invent a waiver, or claim that Charter replaces independent review. If the CLI is unavailable, report that gate as unavailable and assess the remaining risk before delivery.
