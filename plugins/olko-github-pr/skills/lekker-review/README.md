# lekker-review

FAANG-quality PR code review for GitHub. It checks the branch out into an
isolated worktree, gathers the context a human reviewer would gather, runs five
specialist review agents in parallel, tries to refute every finding before it
reports it, and writes a failing test to prove each Critical.

![lekker-review at a glance](assets/poster-overview.png)

## Why it is not a checklist reviewer

Most review tooling reports whatever the model believed on its first pass.
This skill spends most of its budget trying to disprove itself.

![How findings are proved](assets/poster-proof.png)

- **Adversarial verification.** Each finding faces a five-challenge refutation
  from an independent agent. `medium` verifies Criticals, `deep` verifies
  Criticals and Importants.
- **Proof of bug.** A prover agent writes a test asserting the correct
  behaviour, runs it in the worktree, and captures it failing. A proof that
  comes back green is counter-evidence: the finding is downgraded or explicitly
  justified, never quietly kept.
- **Hard-rule exemption.** A finding tagged with a `rule` keeps Critical
  severity and skips verification, because the verifier asks runtime-failure
  questions that a standards violation can never answer.
- **Fix mode.** `--fix` has one agent edit each file, a read-only verifier read
  the real `git diff`, and the captured proof re-run. If the proof stays red the
  group is reverted. Nothing is pushed without explicit confirmation.

## Requirements

Claude Code only. The review pipeline needs the Workflow tool for multi-agent
orchestration and the Artifact tool for the living review page. `git` and an
authenticated `gh` are required.

## Setup

`references/house-rules.md` ships as a template. Replace its example rules with
your team's own non-negotiables, the ones that should always be Critical
regardless of review depth. The skill has no hard rules of its own: everything
blocking comes from that file.

## Usage

```
lekker-review https://github.com/owner/repo/pull/123
lekker-review owner/repo 123 deep --post
lekker-review owner/repo 123 --fix
```

Depth is auto-selected from the diff size when you do not name one: `scan` under
150 changed lines and 5 files, `deep` over 800 changed lines or 25 files or when
the diff touches migrations, `medium` otherwise.

## Regenerating the posters

The posters are self-contained HTML in `assets/`. Open either file in a browser
at a 1280x720 viewport and screenshot it to regenerate the PNG.
