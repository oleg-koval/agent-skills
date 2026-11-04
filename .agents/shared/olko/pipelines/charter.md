<!-- Managed by oleg-koval/fleet from oleg-koval/agents@bf8155937e3615d5fbcba34ff9797682ca4d8da4 -->
# Charter pipeline

## Ownership

This ownership map applies to shared pre-PR requirements in every repository;
the configured Charter workflow below has a narrower scope. The shared ownership
lesson is [ledger note n110](https://github.com/oleg-koval/shared-agent-knowledge/blob/main/ledger.json).

- [Charter](https://github.com/oleg-koval/charter) owns the canonical [Engineering Testament rules](https://github.com/oleg-koval/charter/blob/main/.charter/rules.toml) and their validation tools.
- [Agents](https://github.com/oleg-koval/agents) owns shared agent instructions, including judgment and evidence requirements in the [delivery pipeline](delivery.md).
- [Fleet](https://github.com/oleg-koval/fleet) owns [distribution](https://github.com/oleg-koval/fleet/blob/main/src/agents.ts) of shared agent content and integration with its own [API PR creator and updater](https://github.com/oleg-koval/fleet/blob/main/src/files.ts).
- [ai-dotfiles](https://github.com/oleg-koval/ai-dotfiles) owns the portable [delivery controller](https://github.com/oleg-koval/ai-dotfiles/blob/main/codex/files/scripts/delivery-controller.py) and its host PR creation integration.

Change each policy or integration at its upstream owner, not in Fleet-managed copies. Ownership does not prove a version is installed, distributed, or enforcing a check: verify the target's current sources and creation path. Direct UI, API, or CLI paths can bypass a local creator guard.

## Configured Charter workflow

This pipeline applies only when the target repository has `.charter/rules.toml` and `.charter/checks.toml`. The target files are the contract; this document does not copy their rules. Charter's CLI and command behavior belong to the `oleg-koval/charter` project.

Before invoking Charter or any repository-declared check, inspect the effective commands and the repository-controlled scripts, setup steps, and hooks they invoke. Treat contributor-controlled commands as untrusted. Run untrusted checks only in a disposable environment without credentials, host mounts or sockets, SSH agents, or sensitive filesystem and network access. Do not forward the host environment or secrets into it. If suitable isolation is unavailable, report the check as blocked instead of running it with sensitive access.

1. Read both files and the target repo's `AGENTS.md`. Identify the rules and checks relevant to the proposed diff; do not treat a past run as current evidence.
2. Run `charter doctor` with the target repo's configured directory. Fix missing mappings or report the explicit waiver and its reason.
3. Run `charter check` with the target's event and changed-base settings, plus every locally runnable CI check declared by that repo. Record the exact command and result.
4. For an independent review, use the target's review artifact and run `charter verify-review` when configured. Verify each actionable finding against the final diff.
5. Prepare the PR body from the target template and run `charter verify-pr` when configured. Preserve its required sections.
6. After a push, read the exact remote head and Charter CI job. A local pass and a queued or unavailable remote job are different states.

Do not silently edit a shared rule to make a check pass, invent a waiver, or claim that Charter replaces independent review. If the CLI is unavailable, report that gate as unavailable and assess the remaining risk before delivery.
