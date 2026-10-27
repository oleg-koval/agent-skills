# /self-critique: deep investigation (2026-10-27)

Subject: `olko-reflection/1.59.1/skills/self-critique` (SKILL.md 12.9 KB + `scripts/critique-nudge.mjs` 2.5 KB).
The skill text is identical in the three cached plugin versions (1.54.0, 1.56.2, 1.59.1).

## Local usage evidence

- 122 session transcripts under `~/.claude/projects` contain critic output (`where_wrong` / "iterations to satisfy").
- Distinct reported score trajectories found by grep (14): 62->82, 55->76->85, 68->82->90, 68->84, 66->88->93, 68->85,
  72->85, 55->80->88, 80->89, 66->88, 62->80->90, 62->78->88, 72->84, 58->82.
  Round 1 ranges 55-80 (median ~66); every run gains +15 to +30; 4 of 14 end at >= 90; 0 of 14 scored >= 90 on round 1.
- 28 memory files in the gic-integrations memory dir cite a critic as their origin. One index line
  ("Cause line names the unverified hop") has grown to ~27 semicolon-joined clauses: the "sharpen the existing rule"
  dedupe instruction turned one file into a dumping ground.

## Strong parts

1. External grounding. The critic has live tool access and must refute against sources. This is the one design the
   literature supports (CRITIC 2023, Huang 2023, Kamoi 2024: self-correction from a prompted LLM alone does not work).
2. Claim list before prose, receipt per claim, and a sharp definition of what is NOT a receipt (grep hit, file name,
   sibling behaviour). Pre-marking `unverified` moves the cheapest findings off the critic's bill.
3. `missed` and `shapes`. Most review tools only check what is written. This one hunts for the sibling issue the answer
   should have surfaced, and asks for the class of reasoning error, which feeds Step 5.
4. Step 5, "write the shape, not the incident". Rule + Why (dated receipt) + How-to-apply, recurrence AND cost gates,
   narrowest-store routing, dedupe, and "state where it was written so the user can veto". The 2026 CLAUDE.md-growth
   study found that attaching the reasoning to each instruction removed 99% of excess instructions; this skill already
   does that.
5. Honest report fields: declined fixes ("silently dropping a fix looks identical to missing it"), unverifiable,
   iterations-to-satisfy. Hard cap of 3 rounds, one-challenge rule, same critic for re-score with receipts handed over.
6. The Stop hook fails open, has two loop guards, and only nudges.

## Weak parts

1. The score measures the loop, not the truth. No anchor examples, no rubric weights, one integer mixing correctness,
   completeness and calibration. 0/14 local runs scored >= 90 on round 1, and every run gained 15-30 points: that is the
   signature of a critic paid to find things and then rewarding its own fixes (self-preference bias, "Pride and
   Prejudice" 2024; ledger note n87 "offer an agent an honest branch and it will fabricate the finding").
2. The critic is anchored by the author. It receives the author's own claim list and sources. CoVe, devils-advocate and
   ratchet-review all keep the checker blind to the author's reasoning. Here the critic verifies the author's framing
   instead of re-deriving the claims.
3. Rule littering in practice. The dedupe rule says "sharpen the existing entry", which produced a 27-clause index line
   nobody can read. No expiry, no "did this rule fire" signal, no cap on rules per store, and the "honest test of Step 5"
   is stated but never measured.
4. No cost model. Three rounds of live verification with no model tier guidance, no triage of load-bearing claims
   first, no cheap pre-pass. The project rules elsewhere say critics should run on Sonnet; the skill does not.
5. Findings are not labelled by how they were checked. agent-review-panel tags each finding CMD_CONFIRMED /
   STATIC-INFERENCE; CriticGPT shows critics hallucinate bugs. Here a critic's inferred finding and a command-confirmed
   one carry the same weight, and nothing re-verifies what the critic adds.
6. The hook `block`s the Stop event to force an offer line, which conflicts with the owner's own "hooks act, never
   block" rule, and the 1500-char threshold misses tool-heavy turns (acknowledged in the file).
7. The corrected answer is not the deliverable. The report lists where v1 was wrong; the user still has to mentally
   merge v1 and the fixes. Nothing says "restate the final answer in full".
8. Single lens. Notes mention "give the critic distinct lenses" but the procedure spawns one critic with one prompt.

## Similar work and what to inherit (from the research leaf, all URLs opened)

| Source | Idea worth taking |
| --- | --- |
| ratchet-review (GitHub) | Score anchors (worked examples at 3 levels) and a ratchet: a revision that scores lower is discarded |
| devils-advocate (GitHub) | Checker never sees author's reasoning; mandatory Unverified section; `(recurring)` tag on re-review |
| agent-review-panel (GitHub) | Per-finding epistemic label (command-confirmed / read / inferred); re-verify what the judge adds; "unanimous agreement is the most dangerous failure mode" |
| claude-skill-critique (GitHub) | Triage each finding Worth-fixing / Matter-of-taste / Wrong, with declined ones logged |
| The Fool (jeffallan) | Pre-mortem first pass: assume the answer is wrong, which claim breaks it |
| Chain-of-Verification (2023) | Verification questions answered independently of the draft |
| CriticGPT (2024) | Critics hallucinate bugs: a false-positive filter is part of the design |
| MemGuard (2026) | Each stored lesson carries confidence, status and lifecycle metadata |
| Osmani, "Audit your agent files" | A rule that must always hold belongs in a hook or test, not in prose |
| Catastrophic Remembering (2026) | Prompt files triple in size; the dated Why is the known fix. Keep it, add pruning |

## Killer feature

Today: Step 5. Every other critic tool stops at a score or a list of findings. This one converts each caught error
into a durable rule with a dated receipt and a firing moment, routed to the narrowest store, and tells the user
where it wrote it. 28 rules in one project trace back to it. The pitch: "a critique that ends at a score fixes one
answer; one that ends at a rule fixes every answer after it."

What could be the killer feature (ranked):

1. Rules that prove their own worth. Each rule gets a `fires` counter and `last_fired` date. The critic's first pass
   replays the stored shapes as a checklist against the new answer and marks hits `(recurring)`. A rule that has not
   fired in N sessions is proposed for deletion. This turns memory from a growing file into a measured regression bank,
   and it is the thing no other tool has.
2. Calibrated score. Two or three anchor examples in the prompt, a ratchet, and a per-claim ledger (verified /
   refuted / unverifiable / inferred, each with its receipt) instead of one integer. The claim ledger is also the
   marketing artifact: a screenshot of claims turning green.
3. Blind critic. Hand the critic the original task and the answer only. It extracts claims itself, then the author's
   list is compared with the critic's: claims only one side found are the most interesting output.

## Changes recommended to the skill (smallest set)

1. Critic prompt: remove `{{CLAIMS_AND_SOURCES}}` from the first round; the critic extracts claims blind, then
   receives the author's receipts for round two.
2. Add `checked_by` to every `where_wrong` / `missed` item: `command`, `read`, `inferred`. Author re-verifies
   `inferred` before accepting.
3. Add three score anchors and a ratchet rule (lower re-score discards the revision, report best).
4. Step 5: replace "sharpen the existing entry" with "add one evidence line, max 3 per rule; a fourth incident means
   the rule is wrong, rewrite it". Add `last_fired` and a prune pass.
5. Step 4: end with the full corrected answer, not only the diff of findings.
6. Model tier line: critic on Sonnet unless a Sonnet round found nothing and the answer is load-bearing.
7. Hook: change from `block` to an additive note on the next turn, or keep `block` but document the exception.

## Shipped

2026-10-27: Tasks 1 to 7 landed on branch feat/self-critique-v2. Deterministic tests: ledger 9/9, rule store 7/7, offline e2e 4/4. The headless e2e run (`SELF_CRITIQUE_E2E=1`) was skipped on the first pass by decision of the owner, so there are no live round-one scores yet; run it once and append the two scores here.
