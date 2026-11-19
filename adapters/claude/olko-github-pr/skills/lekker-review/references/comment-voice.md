# comment-voice.md -- how an inline PR comment reads

Used twice by `references/github-post.md`: when drafting inline comments, and by
the polish agent that rewrites them before posting. Adapted for code review from
[Clarity](https://github.com/addyosmani/clarity) by Addy Osmani (MIT). When the
full Clarity skill is installed, the polish agent also reads its
`references/edit.md`; this file stays the authority on shape and length.

## The reader

The PR author, reading one comment at a time in a narrow column, often between
other work. They know their own code. They do not know what the reviewer agents
found, which identifiers the finding hinges on, or why it matters. A comment
succeeds when the author understands the problem and acts without opening the
saved review.

## Shape

```
<The ask: one sentence, plain words, what to change and where.>

**Why:** <what goes wrong, for whom, and when, in plain words first. Then the
mechanism, naming the code only where the author needs it to find the spot.
One concrete scenario when it makes the failure believable.>

<A ```suggestion block when the fix exactly replaces the commented lines,
otherwise: **Fix:** <one sentence>.>
<!-- lekker:<dimension> -->
```

- **Length:** under ~900 characters, not counting the suggestion block. Short
  enough to read in one pass; long enough to carry the why.
- **The ask comes first,** in the imperative or as "Please ...". No severity
  label, no restated title, no preamble.
- **The why names a consequence a person cares about:** a double charge, a
  silently skipped sync, a crash on empty input, a test that cannot fail. Say it
  before the identifiers. "Two copies of the tie-break disagree" is the
  mechanism; "the customer can be charged twice" is the reason to fix it.
- **One scenario, not two.** Use real values from the finding (the quantities,
  the IDs, the input that breaks it). Never invent one.

## Rules carried over from Clarity

1. **Facts are locked.** Every code identifier, `file:line`, number, URL and
   suggestion block in the draft survives unchanged. No new number, scenario,
   cause or claim appears. Keep the strength of each claim: "can" stays "can",
   never "will". `scripts/comment-facts.mjs` checks the tokens mechanically
   and reverts any comment that drifted; it cannot check the meaning of plain
   prose, so claim strength and negation rest on this rule.
2. **Mechanism over importance.** Cut "critical", "crucial", "important to
   note", "significant risk". State what happens and let the author judge.
3. **No specific-looking vagueness.** "This could cause issues in some cases" is
   not a reason. If the finding does not say which case, keep the draft's
   wording rather than inventing one.
4. **Name the actor.** "The retry job writes the line twice", not "a duplicate
   write may occur".
5. **Least invasive change.** A clear draft sentence stays as it is. The polish
   pass fixes what makes a comment hard to read; it does not restyle for taste.
6. **No surface residue.** No "Great catch", "Just flagging", "Note that",
   "It's worth mentioning", "Hope this helps", no praise, no em dashes.
7. **Stop on the last useful thought.** No recap, no "let me know".

## Example

Draft (accurate, but the author has to decode it):

```
Please extract one shared winner-picker used by both files, keyed on FO value.
This ranks value → units → id; `x.ts:104` ranks shipped-qty → id, so FO-A
(qty 1, one $100 item) vs FO-B (qty 3, three $10 items) gives A here and B
there. Idempotency is keyed per `fulfillmentOrderGid` with no cross-FO check,
so a fallback run that writes A's line followed by an exact-path retry on B
writes the same charge twice.
```

Polished (same facts, readable on first pass):

```
Please use one shared function to pick the winning fulfillment order, here and
in `x.ts:104`.

**Why:** the two copies can pick different winners for the same order, and that
charges the shared line twice. This file ranks by value, then units, then id;
`x.ts:104` ranks by shipped quantity, then id. With FO-A (qty 1, one $100 item)
and FO-B (qty 3, three $10 items), this file picks A and `x.ts:104` picks B. The
duplicate check is keyed per `fulfillmentOrderGid`, so a fallback run that
writes A's line followed by an exact-path retry on B writes the same charge
twice.

**Fix:** extract one winner-picker keyed on fulfillment order value and call it
from both files.
```

Every number, identifier and `file:line` from the draft is still there, and
nothing new was added.
