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

A confident answer is not a verified one. This skill turns your last substantial reply into the
subject of a hostile review: a separate critic agent tries to refute it against live sources, hunts
for the related issue or pattern you missed, and scores it. You then revise and re-score until the
score stops moving, report the outcome honestly, including where you were wrong, and convert what
the critic caught into a rule that survives the session.

The point is to surface error before the user does, to make "is this actually right?" a measured
quantity instead of a vibe, and to make the same mistake cost less the second time than it did the
first. A critique that ends at a score has bought one corrected answer. A critique that ends at a
durable rule has bought every answer after it.

## When to Use

- The user asks you to criticize, challenge, stress-test, red-team, or "poke holes in" your own answer.
- The user accepts a "critical-thinking review" offer.
- You have just produced a substantial analysis, recommendation, or investigation and want a
  confidence number before the user acts on it.

Do not use for trivial one-shot replies or simple chat. The overhead only pays off on load-bearing
answers.

## Procedure

1. **Snapshot the target.** Capture your last substantial answer verbatim and the original task
   text. This is `v1`.

   Write your claim list before you re-read the answer's prose, and put a real receipt against each
   claim: a quoted field, a `file:line` whose body you actually opened, a command and its output.
   A claim you cannot receipt at snapshot time is already a finding - mark it `unverifiable` yourself
   rather than waiting for the critic to find it. Grep output, a file name, a path, an endpoint
   string, or the behaviour of a sibling module are not receipts for what code does; they prove
   those things exist, not what they do.

   Save the list to `.self-critique/author-claims.json` as an array of
   `{ id, text, load_bearing, receipt }`. Do NOT show it to the critic in round one.

   **Replay pass.** Before spawning the critic, check the answer against every stored rule. Resolve
   the memory dir as the auto-memory dir for the current project, else the repo's `.claude/memory`;
   if neither exists, skip this pass with a one-line note. Run
   `node <skill>/scripts/rule-store.mjs checklist --dir <memory dir>` and test the answer against
   each rule it prints. Tag each hit `(recurring)` in the report and record it with
   `node <skill>/scripts/rule-store.mjs fire <name> --dir <memory dir> --date <today>`.

2. **Spawn the critic (blind).** Launch one independent agent with live-source access (issue tracker,
   code host, error monitor, the repo). Round one input is the original task text and the answer
   verbatim, nothing else: the critic extracts the claims itself and never sees your list or sources.
   Use the prompt template below. The critic must return one fenced JSON block with `claims` (its own
   list, each `{ text, load_bearing, status, checked_by, receipt }`), `missed`, `where_wrong`,
   `shapes` and `verdict` (AGREE / AGREE-WITH-CAVEATS / DISAGREE). There is no `score` field: the
   score is computed in Step 2b.

2b. **Merge into the ledger.** Match the critic's claims to yours by meaning and set `origin` on
   each: `both`, `author` (only you found it), `critic` (only the critic found it). Every critic
   finding with `checked_by: inferred` must be re-verified by you before it may become `refuted`;
   if you cannot verify it, it stays `inferred`. A `refuted` claim with `checked_by: inferred` is
   rejected by validation. Save `.self-critique/ledger-v1.json`, then run
   `node <skill>/scripts/claim-ledger.mjs score .self-critique/ledger-v1.json` and
   `node <skill>/scripts/claim-ledger.mjs summary .self-critique/ledger-v1.json` (an invalid ledger
   exits 2 and prints the errors as JSON).
   Claims found by only one side are reported under their own heading, "Asymmetric claims".

   Ledger shape (`version` is always `1`):

   ```json
   { "version": 1,
     "claims": [{ "id": "c1", "text": "...", "load_bearing": true, "origin": "both",
                  "status": "verified", "checked_by": "command", "receipt": "quoted output" }],
     "missed": [{ "id": "m1", "text": "...", "load_bearing": false, "checked_by": "read" }] }
   ```

   - `origin`: `author` | `critic` | `both`
   - `status`: `verified` | `refuted` | `unverifiable` | `inferred`
   - `checked_by`: `command` (run, output quoted) | `read` (file or record opened, quoted) |
     `inferred` (reasoning only). Required on `missed` items too; an `inferred` missed item is not
     penalised, and a `refuted` claim may not be `inferred`.

3. **Decide and loop.** Stop when the score is at least 90, OR no `refuted`, `missed`, or
   load-bearing `unverifiable` ledger item is left that a revision could fix, OR 3 rounds have run.
   Otherwise revise the answer to produce `v2`, write `ledger-v2.json`, and run
   `node <skill>/scripts/claim-ledger.mjs ratchet .self-critique/ledger-v1.json .self-critique/ledger-v2.json`
   on the previous and new ledger: a lower re-score discards the revision, and you keep the winner. Round
   two and later hand the critic your receipts for the still-open claims (it is no longer blind).
   **Hard cap: 3 critic rounds.** (A known ceiling: raise it only if a round is still finding real,
   fixable defects.)

   **Cost.** The critic runs on a mid-tier model (Sonnet class) by default. Escalate one tier only
   when a mid-tier round found nothing and the answer is load-bearing. When the budget is tight,
   verify load-bearing claims first.

4. **Report, always, even after a single round.** In this order:
   - **Corrected answer (`v_final`)** - restated in full, not as a diff, so the user can act on it
     without reading anything else. After a single round with no revision, restate `v1` unchanged.
   - **Claim ledger** - the table printed by `node <skill>/scripts/claim-ledger.mjs summary .self-critique/ledger-v1.json`, with the computed score.
   - **Where you were wrong** - consolidated, each item with the receipt the critic cited.
   - **Asymmetric claims** - claims only you found, and claims only the critic found.
   - **Recurring rules fired** - each stored rule the replay pass hit, with its new `fires` count.
   - **Iterations to satisfy** - how many critic rounds it took (1 means it was solid first pass).
   - **Score trajectory** - for example `72 -> 88 -> 94 (+22 pts)`, all computed scores. If only one
     round ran, state `no revision needed`.
   - **Unverifiable** - anything you should not present as fact.
   - **Declined findings** - ledger items you chose not to fix, with the reason. Silently dropping
     one looks identical to missing it.
   - **Rules written** - where each rule went and what it says (see Step 5).
   - **Rules proposed for deletion** - the candidates from the prune pass, or `none`.

5. **Convert the outcome into a durable rule.** See below. Skipping this step is what makes the
   same critique necessary again next week.

## Step 5: turn the critique into something that outlives the session

A score is a measurement, not an improvement. The improvement is the rule you write down, in a
place a future session actually reads, before you move on.

**Not every finding earns a rule.** Write one only when the finding passes both gates:

- **Recurrence** - the same *shape* of mistake could plausibly happen again on a different task.
- **Cost** - it would have reached the user, cost real rework, or damaged their credibility with
  someone else.

A one-off factual slip, a typo, or a finding fully explained by this task's specifics fails both.
Writing a rule for it pollutes the store, and a littered store is worse than a thin one, because
the next session stops reading it.

**Write the shape, not the incident.** The incident is the evidence; the shape is the rule. Ask
what class of reasoning produced the error, then name that class:

| Incident | Shape worth keeping |
| --- | --- |
| Called an endpoint a read because the path was a noun and a sibling module imported | A conclusion drawn from evidence that does not cover the claim |
| Priced an open design question as "small" in the same sentence that asked which design was wanted | Never attach a size to an answer you are simultaneously asking for |
| Described a batch from the one member that was checked | Check the risk-deciding field on every member before describing the set |

**Route it to the narrowest store the host has**, in this order, and only one of them:

1. The user's or project's agent memory, when the rule is about how to work with this user or this
   project.
2. The repository's own `CLAUDE.md` / `AGENTS.md`, when the rule is true only inside that codebase.
3. A shared, cross-session store, when the rule holds across projects. Use `context-repo` to resolve
   it, or `shared-knowledge-artifact` when several agents need to read the same ledger.

Broadening a rule's scope so it qualifies for a wider store is the failure mode to avoid: one
incident on one afternoon is not standing policy. Let the evidence decide where it lands.

**Each rule carries three things.** Without all three the next session cannot act on it:

- **The rule**, stated as the shape, in the imperative.
- **Why**, with the incident and its receipt, dated. A rule with no cost attached gets argued away.
- **How to apply**, naming the moment the rule fires ("before drafting outbound text", "before
  describing a batch"), not just the principle.

Before writing to shared persistence, redact the incident evidence, including when using
`context-repo` or `shared-knowledge-artifact`, while still including the incident and its dated
receipt. This redaction requirement does not apply to local agent memory or repository-rule writes.

**Dedupe before writing.** Read the store first. If a rule of the same shape exists, add one dated
evidence line to it instead of creating a second entry, with at most three evidence lines per rule.
A fourth incident means the rule named the incident, not the shape: rewrite the rule text and keep
the three most recent evidence lines. Link related rules instead of restating them. Run
`node <skill>/scripts/rule-store.mjs evidence-check --dir <memory dir>` before writing and report
any rule it flags.

**Counters are not hand-edited.** A stored rule's `fires` and `last_fired` live under `metadata:` in
the memory file's frontmatter and are written only by `fire`.

**Prune pass.** At the end of this step run
`node <skill>/scripts/rule-store.mjs prune --dir <memory dir> --idle-days 60`. List the candidates
in the report under "Rules proposed for deletion". Never delete a rule without the user's reply.

**Then close the loop.** State in your report where the rule was written and what it says, so the
user can veto it. A rule the user has not seen is a rule they cannot correct.

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

### Score anchors

The score is `100` minus penalties, floored at 0. Calibrate against these three ledgers (all claims
`origin: both`; `node <skill>/scripts/claim-ledger.mjs anchors` prints them as JSON).

**Strong, score 95**

| id | load_bearing | status | checked_by |
| --- | --- | --- | --- |
| a1 | no | inferred | inferred |

**Middling, score 72**

| id | load_bearing | status | checked_by |
| --- | --- | --- | --- |
| b1 | no | refuted | read |
| b2 | no | refuted | read |
| b3 | no | unverifiable | read |
| b4 | no | unverifiable | read |

**Weak, score 40**

| id | load_bearing | status | checked_by |
| --- | --- | --- | --- |
| c1 | yes | refuted | read |
| c2 | yes | refuted | read |
| c3 | yes | unverifiable | read |

Penalties:

| Finding | Points off |
| --- | --- |
| refuted, load-bearing | 25 |
| refuted | 10 |
| unverifiable, load-bearing | 10 |
| unverifiable | 4 |
| inferred, accepted | 5 |
| missed, load-bearing | 15 |
| missed | 5 |
| verified but found only by the critic | 5 |

## Optional: auto-offer via a Claude Code Stop hook

A hook is a shell command, so it cannot run this loop itself. What it can do is **nudge**: after a
substantial answer, it offers the review and you run the skill only if the user says yes.

The hook ships with this skill at `scripts/critique-nudge.mjs`. Register it as a `Stop` hook in your
Claude Code settings (`.claude/settings.json` for a team, `.claude/settings.local.json` for
yourself):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/critique-nudge.mjs\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

Copy `scripts/critique-nudge.mjs` to `.claude/hooks/critique-nudge.mjs` (or point the command at
wherever you keep it). After an answer whose final prose is at least 1500 characters, the hook blocks
the turn once and instructs the agent to append a one-line "critical-thinking review" offer, then
stop. Two loop guards keep it from firing forever: it does nothing when `stop_hook_active` is set, and
nothing when the answer already contains the offer phrase. On any malformed input it exits silently
and never blocks the user.

The 1500-character threshold is a heuristic with a known ceiling: it misses short but dense
tool-heavy turns. If that matters, extend the script to also count tool calls since the last user
message.

## Notes

- One critic round is fine and common. If the answer was already solid, report
  `iterations: 1, no revision needed` and the single score rather than forcing a revision.
- Diversity beats redundancy: if a claim can fail in more than one way, give the critic distinct
  lenses (correctness, completeness, does-it-reproduce) instead of repeating the same check.
- The critic verifies against live sources; it does not rewrite the answer or score it. You revise;
  the score is recomputed from the ledger.
- In round two, hand the critic your receipts for the claims still open, so it spends its budget on
  the claims still standing instead of re-deriving the ones already settled.
- A critic finding you disagree with is worth one challenge. Put the reasoning to it and let it rule;
  if it concedes, that is a real answer for the report, and the reasoning is what the user needs to
  see either way.
- The honest test of Step 5 is not that a rule was written, it is that the next task of the same
  class does not need this skill to catch the same thing. If it does, the rule named the incident
  instead of the shape - rewrite it, do not add another.
