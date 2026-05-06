---
name: starter-rules
description: Load and enforce the hard rules every oleg-koval/* starter must obey. Use when starting or auditing work in saas-init, ts-npm-starter, go-starter, py-starter, or any future oleg-koval template repo. Covers functional style, 300-line file cap, E2E > unit tests, pre-commit hooks, no-comment policy, KISS/DRY/SOLID, and Vertical Slice as default architecture for SaaS/app starters.
license: MIT
compatibility: Codex, Claude Code, Cursor, and other Agent Skills compatible tools.
metadata:
  author: Oleg Koval
  tags:
    - starters
    - rules
    - architecture
    - vertical-slice
    - linting
    - pre-commit
---

# Starter Rules

## Overview

Load the canonical hard rules for every `oleg-koval/*` starter repo and verify the current repo complies with them. Produces a compliance report and a list of gaps to fix.

## When to Use

- Starting a new coding session in any `oleg-koval/*` template repo
- Auditing an existing starter for rule compliance before a release or PR merge
- Onboarding a new contributor (human or AI) to a starter
- After a large refactor, to verify rules have not been silently violated

Do not use for repos outside the `oleg-koval` namespace unless they explicitly reference `RULES.md`.

## Workflow

1. **Load the rules** — read `RULES.md` from the repo root. If absent, fetch it from `https://github.com/oleg-koval/starters/blob/main/RULES.md` and note that the starter is missing a local copy.

2. **Apply §2 hard rules** — for the current task or PR diff, verify:
   - No file exceeds 300 lines (`find . -name '*.ts' -o -name '*.py' -o -name '*.go' | xargs wc -l | awk '$1 > 300 && $2 != "total"'`)
   - No functions produce side effects outside of boundary layers
   - New code has no WHAT-comments; WHY-comments are one line max
   - Tests are E2E-first; unit tests only for pure logic with non-trivial branching

3. **Verify hooks and lint** — check that pre-commit hooks are installed and configured:
   - TypeScript: `cat .eslintrc* | grep max-lines` and `cat package.json | grep -A5 '"lint-staged"\|"husky"\|"lefthook"'`
   - Python: `cat .pre-commit-config.yaml` and check for `ruff` + format hooks
   - Go: `cat .golangci.yml` or `.pre-commit-config.yaml` and check for `golangci-lint` + `gofmt`

4. **Check architecture** — for app/SaaS starters: confirm feature code is organized as vertical slices (feature directory contains handler + DTO + service + tests together). For library starters: skip.

5. **Report gaps** — list any violations found in steps 2–4. For each gap:
   - Name the rule (e.g., "§2.2 file length")
   - Name the file and line count or violation
   - Propose the minimal fix

6. **Fix on request** — if the user asks to fix the gaps, apply them one at a time, smallest change first. Do not refactor beyond what the rule requires.

## Reference

Full rule details: [`RULES.md`](./RULES.md)

Architecture options and future starters: `RULES.md §3`

Unix principles: `RULES.md §4`

## Verification

- [ ] `RULES.md` was read from the repo root (or fetched and absence noted)
- [ ] File length check ran with zero violations, or violations were listed
- [ ] Pre-commit hooks verified as installed and configured
- [ ] Compliance report produced listing passed checks and gaps
- [ ] Any fixes applied do not exceed the scope of the violated rule
