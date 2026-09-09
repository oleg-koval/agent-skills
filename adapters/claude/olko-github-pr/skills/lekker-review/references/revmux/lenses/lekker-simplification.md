---
description: over-engineering and DRY violations, plus Teifi's debug-artifact hygiene table
---
## Lens: lekker-simplification

Review the change for over-engineering and DRY violations.

Look for:
- Copy-paste logic: identical blocks that differ only in a constant — flag
  for extraction.
- Parallel implementations: two functions doing the same thing — one should
  call the other.
- Unnecessary abstraction inversion: private helper called exactly once, adds
  no reuse — should be inlined.
- Over-engineered control flow: nested ternaries / promise chains that could
  be plain if/else or async/await.
- Config spread: same magic constant defined in multiple files.
- Debug artifacts and hygiene: apply the fixed severity table in §3 of
  `{{PROFILE}}` (the Teifi conventions section) — `debugger` and
  `.only`/`fit`/`fdescribe` are critical, an added `console.log`/`console.debug`
  in production code and a hardcoded URL are major, an unreferenced
  TODO/FIXME and a >3-line commented-out block are minor. Those severities
  are fixed: do not soften them, and only flag occurrences the diff ADDED.
- Wrapper that adds nothing, factory for single implementation, layer-cake
  anti-pattern (handler → service → repo with no logic in any layer).
- Feature flags always on/off, fallback that can never trigger, dual
  implementations where old has no callers.
- Relocated complexity: a refactor that moves code without reducing the number
  of concepts a reader must hold to follow it. Count them before and after. If
  the count is unchanged, the restructuring did not simplify anything, and the
  finding is that a cheaper move was available (deleting a branch, a mode, or a
  layer outright, rather than re-centralising the same logic). Major when
  the change is sold as a cleanup or refactor, minor otherwise.
- Feature logic in a shared module: feature-specific behaviour added to a
  general-purpose util, a shared client, or a base class. The branch belongs in
  the package that owns the concept. Name the owning layer in the fix.
- Dead code this diff orphans: when the diff replaces or reroutes something,
  grep the worktree for remaining callers of what it superseded (the old helper,
  the old component, a now-unreferenced constant, a flag that can no longer be
  false). Enumerate what is now unreachable. NEVER propose a silent deletion:
  the fix lists the orphans and asks the author to confirm removal.
  Minor, or major when the dead path is still reachable from production code.

Only flag where duplication or complexity creates a real maintenance risk or
bug surface — not aesthetic preference.

When you flag a structural problem, name the move, not just the smell: replace a
chain of conditionals with a typed model or an explicit dispatcher, collapse
duplicate branches into one flow, separate orchestration from business logic,
move feature logic into the package that owns it, reuse the canonical helper
instead of a near-duplicate, delete a pass-through wrapper. Prefer the remedy
that removes moving pieces over one that spreads the same complexity around. A
finding that says "this is complex" without naming the restructuring is not
actionable: name the move or drop the finding.

Rules:
- Every finding must trace to a `+` line in the diff.
- Report file:line — description. No positive observations.
- Quote the verbatim offending line(s) — never paraphrased, never reconstructed
  from memory — and give a concrete drop-in fix, or when the fix is
  architectural, a minimal skeleton plus one sentence on what else must change.
- A finding you cannot quote and cannot fix is a finding you have not proven —
  drop it instead.
