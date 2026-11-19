---
name: self-critique
description: Adversarially critique your own last answer: a blind critic agent re-derives and verifies every claim against live sources, the score is computed from a labelled claim ledger, you revise under a ratchet, restate the corrected answer, and turn each caught error into a durable rule with a fire counter.
license: MIT
compatibility: Codex, Claude Code, Cursor, and other Agent Skills compatible tools.
metadata:
  author: Oleg Koval
  tags:
    - critical-thinking
    - self-review
    - verification
    - adversarial
    - agents
    - quality
---

# Self-critique

Run an adversarial review of **your own previous answer** and report the result in numbers.

## Overview

A confident answer is not a verified one. A separate critic agent tries to refute your last answer
against live sources and hunts for the related issue or pattern you missed. The score is computed
from a labelled claim ledger. You revise under a ratchet, report honestly including where you were
wrong, and convert what the critic caught into a rule that survives the session. A critique that ends
at a score has bought one corrected answer; one that ends at a durable rule has bought every answer
after it.

## When to Use

- The user asks you to criticize, challenge, stress-test, red-team, or "poke holes in" your own answer.
- The user accepts a "critical-thinking review" offer.
- You have just produced a substantial analysis, recommendation, or investigation and want a
  confidence number before the user acts on it.

Do not use for trivial one-shot replies or simple chat. The overhead only pays off on load-bearing
answers.

Setup notes (state dir, Cursor install, the optional Stop-hook nudge): `references/setup.md`.
Penalties, anchors, ledger shape and integrity checks: `references/scoring.md`.

## Procedure

1. **Snapshot the target.** Capture your last substantial answer verbatim and the original task
   text. This is `v1`. Create the run folder (outside the repo, one per run) and use it for every
   file below:

   ```bash
   RUN=$(node <skill>/scripts/run-store.mjs new --cwd "$PWD")
   ```

   Write your claim list before you re-read the answer's prose, and put a real receipt against each
   claim: a quoted field, a `file:line` whose body you actually opened, a command and its output.
   A claim you cannot receipt at snapshot time is already a finding: mark it `unverifiable` yourself
   rather than waiting for the critic to find it. Grep output, a file name, a path, an endpoint
   string, or the behaviour of a sibling module are not receipts for what code does.

   Save the list to `$RUN/author-claims.json` as an array of `{ id, text, load_bearing, receipt }`.
   Do NOT show it to the critic in round one.

   **Replay pass.** Before spawning the critic, check the answer against this skill's own rules.
   Resolve the memory dir as the auto-memory dir for the current project, else the repo's
   `.claude/memory`; if neither exists, skip replay, evidence-check, and prune with a one-line note.
   Run `node <skill>/scripts/rule-store.mjs checklist --dir <memory dir>`. It lists only rules marked
   `rule_store: self-critique`; open only those files and read each body before testing the answer
   against it (names and descriptions alone are insufficient). Do not read the rest of the memory
   dir. Tag each hit `(recurring)` in the report and record it with
   `node <skill>/scripts/rule-store.mjs fire <name> --dir <memory dir> --date <today>`.

2. **Spawn the critic (blind).** Launch one independent agent with live-source access (issue tracker,
   code host, error monitor, the repo). Round one input is the original task text and the answer
   verbatim, nothing else: the critic extracts the claims itself and never sees your list or sources.
   Use the prompt template below. The critic returns one fenced JSON block with `claims`, `missed`,
   `where_wrong`, `shapes` and `verdict`. There is no `score` field. **Save the returned JSON
   verbatim** as `$RUN/critic-r<N>.json` (N is the round); the ledger is checked against it.

2b. **Merge into the ledger.** Match the critic's claims to yours by meaning and set `origin` on
   each: `both`, `author` (only you found it), `critic` (only the critic found it). Every entry
   carries its link back: `author_id` (the id in `author-claims.json`) for `author` and `both`,
   `critic_ref` (`"r1:claims.3"` or `"r1:missed.1"`) for `critic` and `both` and on every `missed`
   entry. Nothing from either side may be left out: every author claim and every critic item needs
   an entry. Every critic finding with `checked_by: inferred` must be re-verified by you before it
   may become `verified` or `refuted`; if you cannot, it stays `inferred` (and costs the same as
   unverifiable when load-bearing). Save `$RUN/ledger-v1.json`, then run, always with all three
   flags that apply (`--prev` from round two on):

   ```bash
   node <skill>/scripts/claim-ledger.mjs score $RUN/ledger-v1.json \
     --author $RUN/author-claims.json --critic r1=$RUN/critic-r1.json [--prev $RUN/ledger-v<N-1>.json]
   node <skill>/scripts/claim-ledger.mjs summary $RUN/ledger-v1.json
   ```

   A ledger that drops a claim, cites a missing critic item, or loses an id from the previous round
   exits 2 with the errors as JSON: fix the ledger, not the check. Output with
   `"integrity": "unchecked"` was run without those flags and may not be reported as a score.
   Claims found by only one side go under "Asymmetric claims".

3. **Decide and loop.** After each round run
   `node <skill>/scripts/claim-ledger.mjs status $RUN/ledger-v1.json [$RUN/ledger-v2.json ...]`.
   It prints `first_score`, `final_score`, `trajectory`, `open` (`load_bearing` and `other` counts)
   and `done`. **Stop when** `done` is true (no load-bearing claim is refuted, unverifiable or
   inferred, and no load-bearing missed item remains, inferred ones included), OR nothing left open can be fixed by a
   revision (say why in "Declined findings"), OR 3 rounds have run. There is no score threshold:
   the critic-only penalty can never be revised away, so a score target would loop on nothing.

   Otherwise revise the answer to produce `v2`, write `$RUN/ledger-v2.json` (it keeps every earlier
   claim id), and run
   `node <skill>/scripts/claim-ledger.mjs ratchet $RUN/ledger-v1.json $RUN/ledger-v2.json --author $RUN/author-claims.json --critic r1=$RUN/critic-r1.json --critic r2=$RUN/critic-r2.json`.
   A lower re-score discards the revision and you keep the winner. Round two and later hand the
   critic your receipts for the still-open claims (it is no longer blind). **Hard cap: 3 critic
   rounds.**

   **Cost.** The critic runs on a mid-tier model (Sonnet class) by default. Escalate one tier only
   when a mid-tier round found nothing and the answer is load-bearing. When the budget is tight,
   verify load-bearing claims first.

4. **Report, always, even after a single round.** Lead with two numbers, then the rest in order:
   - **Headline** - the first-answer score (round 1, what the user would have got without this
     skill) and the open-defect count from `status` (load-bearing and other). The first-answer
     score is the honest quality number; the final score only measures the revision.
   - **Corrected answer (`v_final`)** - restated in full, not as a diff. After a single round with
     no revision, restate `v1` unchanged and label it unrevised. If load-bearing defects are still
     open, give their count and the stop reason beside it; never call that outcome clean.
   - **Score trajectory** - for example `72 -> 88 -> 94 (+22 pts)`, all computed. If only one round
     ran with `done` true, state `no revision needed`; if it stopped with load-bearing defects open, say that instead. Add the trend from
     `node <skill>/scripts/run-store.mjs history --cwd "$PWD"` (first-answer score per run).
   - **Claim ledger** - the `summary` table for the ledger the ratchet kept, and its `score` with
     `integrity: checked`.
   - **Where you were wrong** - consolidated, each item with the receipt the critic cited.
   - **Asymmetric claims** - claims only you found, and claims only the critic found.
   - **Recurring rules fired** - each stored rule the replay pass hit, with its new `fires` count.
   - **Iterations to satisfy** - how many critic rounds it took (1 with `done` true means it was solid first pass).
   - **Unverifiable** - anything you should not present as fact.
   - **Declined findings** - ledger items you chose not to fix, with the reason. Silently dropping
     one looks identical to missing it.
   - **Rules written** and **Rules proposed for deletion** (Step 5), or `none`.

5. **Convert the outcome into a durable rule.** Skipping this step is what makes the same critique
   necessary again next week. Write a rule only when the finding passes both gates:

   - **Recurrence** - the same *shape* of mistake could plausibly happen again on a different task.
   - **Cost** - it would have reached the user, cost real rework, or damaged their credibility.

   A one-off factual slip, a typo, or a finding fully explained by this task's specifics fails both;
   a littered store is worse than a thin one. Write the shape (the class of reasoning that produced
   the error), not the incident. Route it to the narrowest store, in this order, and only one:
   (1) the user's or project's agent memory, (2) the repo's `CLAUDE.md` / `AGENTS.md`, (3) a shared
   cross-session store. Each rule carries three things: **the rule** in the imperative, **why** (the
   incident, dated, with its receipt), and **how to apply** (the moment it fires). Mark memory rules
   `rule_store: self-critique`, dedupe before writing, run the prune pass, and tell the user what you
   wrote so they can veto it. Shapes table, routing detail, dedupe, redaction, identity and the
   prune pass: `references/rules.md`.

## Critic prompt template

Pass this to the critic agent, filling in the two placeholders (`{{TASK}}`, `{{ANSWER}}`). It is deliberately adversarial:
the default stance is that the answer is wrong until a live source proves otherwise.

> You are an adversarial reviewer. Your job is to verify and, where possible, **refute** the answer
> below. Default to skepticism: assume a claim is wrong until a live source proves it. Address every
> comment **directly to the author** ("You claimed X; the source says Y").
>
> **The task the author was given (verbatim):**
> {{TASK}}
>
> **The answer under review (verbatim):**
> {{ANSWER}}
>
> You are not given the author's claims or sources. Extract the claims yourself.
>
> **Do this:**
> 1. List every claim the answer makes, marking each `load_bearing` (the user would act on it).
>    Re-verify each against the **live** source (issue tracker / code host / error monitor / the
>    repo) - never trust the answer's own summary. Quote the field, line, PR body, or issue you
>    checked.
> 2. **Check similar and related issues, and find patterns.** Is this part of a cluster? Is there a
>    closer sibling, parent epic, or duplicate the answer should have surfaced but did not? Name it
>    with its ID and the shared signal (same error, same code path, same root cause).
> 3. Stress-test the **strongest** load-bearing claim and the answer's biggest blind spot
>    specifically. Where is it over-confident? Where is symptom-level reasoning passing itself off as
>    a proven root cause?
> 4. List exactly **where the author was wrong or imprecise**, and what they **missed**.
> 5. Flag any claim you **could not verify** so it is not presented as fact.
> 6. Label every finding with `checked_by`: `command` (you ran it and quote the output), `read` (you
>    opened the file or record and quote it), `inferred` (reasoning only).
>
> **Output, terse, one fenced JSON block, a receipt for every item:**
> - `claims`: your own list, each `{ text, load_bearing, status, checked_by, receipt }` with `status`
>   one of `verified` | `refuted` | `unverifiable` | `inferred`
> - `missed`: related issues or patterns the author failed to surface, each
>   `{ text, load_bearing, checked_by, receipt }`, with IDs
> - `where_wrong`: bullet list, each with its source receipt and `checked_by`
> - `shapes`: for each item in `where_wrong`, the class of reasoning that produced it, stated so it
>   would apply to a different task ("a conclusion drawn from evidence that does not cover the
>   claim"), not the incident itself. Say `one-off` when the error has no reusable shape.
> - `verdict`: AGREE | AGREE-WITH-CAVEATS | DISAGREE
>
> Do not output a score. It is computed from your claims.

## Notes

- One critic round is fine and common. If the answer was already solid (`done` true), report
  `iterations: 1, no revision needed` and the single score rather than forcing a revision.
- Diversity beats redundancy: if a claim can fail in more than one way, give the critic distinct
  lenses (correctness, completeness, does-it-reproduce) instead of repeating the same check.
- The critic verifies against live sources; it does not rewrite the answer or score it. You revise;
  the score is recomputed from the ledger.
- A critic finding you disagree with is worth one challenge. Put the reasoning to it and let it rule;
  if it concedes, that is a real answer for the report, and the reasoning is what the user needs to
  see either way.
