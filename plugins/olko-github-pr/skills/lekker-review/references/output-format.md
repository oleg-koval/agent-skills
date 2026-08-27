# Output format (Step 4)

## Step 4 — Format Output

Output is **one unified markdown document** — detailed enough to stand on its
own, clean enough to paste directly into GitHub. No ANSI split, no stripped
copy-paste block. Every finding includes location, the bad code, the reason,
and the fix — all in standard GitHub markdown.

Output the review as a markdown response (not via printf). No ANSI escapes.

---

### Output format

```
## Review — [PR #<PR_NUMBER> — <title>](<PR_URL>)

**Author:** <author> · **Branch:** `<headRefName>` → `<baseRefName>`
**Size:** +<additions>/-<deletions> across <changedFiles> files
**Head:** `<headRefOid short sha>`
**Linear:** [<ticket-id>](<linear-url>) — <ticket title>
**Findings:** <X Critical / Y Important / Z Observations / W Idiomatic>
**Proofs:** <M proven / N attempted> *(include only when N > 0)*
**CI:** <✅ All passing | ⚠️ N failing: check-name | ⏳ Pending | N/A>
**Depth:** <⚡ scan | 🔍 medium | 🔬 deep>

---

*(If PR_TITLE_ISSUE = true, insert this block here — before the Summary. Omit entirely if PR_TITLE_ISSUE = false.)*

> ⛔ **CANNOT MERGE — PR title missing Linear ticket prefix**
>
> The PR title must start with the Linear ticket(s) in square brackets.
> Recommended title prefix: **`<RECOMMENDED_PREFIX>`**
>
> How to fix: edit the PR title on GitHub to start with `<RECOMMENDED_PREFIX> <rest of current title>`.

---

## 🔁 Since last review

*(Re-review mode only — include when PREV_SHA was found. Omit entirely on first review.)*

Reviewed delta: `<PREV_SHA short>..<head short>`

- ✅ Fixed: <prior finding title> (`file:line`)
- ⚠️ Still open: <prior finding title> (`file:line`) — <one line on current state>

---

### Summary

A substantive 2–3 paragraph narrative — NOT a one-line recap. A reader who
hasn't seen the ticket or the diff should finish the Summary understanding
*why this work exists* and *what it buys the business/team*, before any finding.
Cover, in roughly this order:

- **The problem / goal — why this PR exists.** What was broken, missing, or
  needed? Pull this from the Linear ticket (the AC_LIST and ticket summary),
  not just the diff. State the user-facing or business outcome the change is
  reaching for ("RSL can create P21 contacts automatically from Shopify instead
  of hand-keying them", "unblocks the PUT/update flow that depends on the
  metafield being populated").
- **What it does — the mechanism, in plain terms.** The shape of the solution:
  the key entry points, the data flow, the gating/safety mechanisms, and how the
  pieces fit. Name the design choices and *why each one was made* — kill switch
  (so it can ship dark and be flipped per-environment), idempotency gate (so
  re-deliveries don't duplicate), validation (so bad payloads fail fast and
  non-retryably), stacking/deferral (so concurrency lands in a reviewable second
  PR). The reader should learn the rationale, not just the inventory.
- **Risk level + recommendation.** Land on the overall risk and what you advise:
  ship as-is, ship after the Important fixes, or hold. If the headline risk is a
  single finding, name it here in one sentence and point forward to it.

Lead with the goal and the mechanism; keep the risk framing honest. This section
sets the altitude for everything below — a risky PR should read as risky. Do NOT
editorialize about what the PR does *well*: no praise, no "the win", no
"cleanly/nicely implemented", no complimenting the design. State what it does and
what the risks are — nothing about how good it is.

---

**Verdict: <✅ LGTM — ship it | ⚠️ LGTM with changes | 🚫 Needs work>**

---

## 🔥 Production Signals

*(Include only when SENTRY_SIGNALS has entries. Omit section entirely if empty.)*

- [<issue title>](<sentry-url>) — <N> events / <M> users (7d) · first seen <date>
  Files: <relevant files from stack trace>
  Note: <does this PR fix, worsen, or not affect this error?>

---

## 🚨 Critical — must fix before merge

### #1 — <short label>

**File:** `<path/to/file.ts>:<line>` · **Risk:** <one sentence — what breaks and when>

**Current code:**
\```ts
<the actual bad lines from the diff, verbatim>
\```

**Why it's wrong:** <explanation — what the code does vs what it should do.
Include the concrete failure: "lookup always returns undefined because the key
is triple-wrapped", "crashes with TypeError on Node 20 because Map.groupBy
does not exist", etc. If the author might not believe it, include a short
proof inline.>

**Fix:**
\```ts
<corrected version — exact drop-in replacement or minimal diff>
\```

**Proof — ran in the worktree:** *(include only when the finding carries a `proof` with `proven: true`)*
\```
<redOutput, verbatim>
\```
*Test asserts the correct behavior and fails because of this bug. It flips green when fixed.*

---

### #N — <label>
...

*(None.)* ← only if section is empty

---

## ⚠️ Important — should fix

(same per-finding format, continuing the numbering sequence)

*(None.)* ← only if section is empty

---

## 📝 Observations

- <note — tradeoff, risk to watch, or design question worth raising>

PR-level notes belong here, since they have no single file:line. Two are
produced by Step 3 rather than by an agent:
- **Sizing:** when the PR exceeds the sizing thresholds, or mixes a refactor
  with new behaviour, state the recommended split and the strategy.
- **Verification story:** when the PR body says nothing about how the change was
  verified, name the evidence that is missing (tests run, manual exercise,
  screenshots for UI, before/after for behaviour or performance).

*(Omit section entirely if empty.)*

## 🧪 Test Quality

**Coverage verdict:** <✅ Well tested | ⚠️ Partially tested | ❌ Under-tested | N/A — no logic changes>

<One paragraph: overall assessment — what is tested, what is missing, and
whether the test suite would catch a regressing change to this code.>

**Gaps:**
- `test-file:line` — <gap or weakness>
- `test-file:line` — <implementation-coupled test: IO mocked to reach logic,
  call-shape spy, component mocked for its props, query hook mocked, or an
  implementation-detail assertion>
  → **Fix:** <no-mock refactor — usually "extract a pure function over plain
  data and test that" or "inject a simple fake and assert the output">

*(Omit if no mocking issues. Do not flag legitimate mocks — error paths,
pinned non-determinism, un-runnable dependencies.)*

**Mutation-slip risk:** <paragraph — which mutation classes would go undetected,
if any. "No obvious gaps found." if clean.>

*(Omit section entirely if no test changes and no business logic changes.)*

---

## 💡 Idiomatic & Consistency

- **<deviation>** (`<file>:<line>`) — <the idiomatic alternative in one line>.
  Precedent: `<file>:<line>` where the established pattern already lives.

*(Non-blocking suggestions — do NOT affect the verdict. Omit section entirely
if empty.)*

---

## 💰 Review Cost

```
Depth:            <⚡ scan | 🔍 medium | 🔬 deep>
Diff size:        ~<N> lines (~<N> tokens)
Agents run:       <N total> — <breakdown, e.g. "5 reviewers (sonnet) + 6 verifiers (sonnet) + 2 provers (sonnet) + 1 critic (sonnet)">
Verify skipped:   <N> hard-rule finding(s) exempt from adversarial verification (omit the line when 0)
Context sources:  <the subset of issue-tracker / chat / docs / framework-docs / monitoring / CI / prior-review-memory actually used>

Output tokens:    <N>   ← ACTUAL workflow spend, from the workflow's outputTokens return value
Turn total:       <N>   ← whole-turn shared pool (turnTokensTotal), main loop included
Input tokens:     ~<N>  ← estimated: diff tokens × agent passes + context files + prompt files

Cost: ~$<X.XX>  (output actual, input estimated; blended across model tiers below)
```

Per-MTok pricing (input/output) — verified 2026-07-07 from the claude-api reference; re-check there if models changed:
- claude-fable-5: $10 / $50
- claude-opus-4-8: $5 / $25
- claude-sonnet-4-6 / claude-sonnet-5: $3 / $15
- claude-haiku-4-5: $1 / $5

Reviewer agents, verifiers, provers, and the critic all run on sonnet; triage and housekeeping on haiku. Only the main loop (context gathering + this synthesis) runs on the session model — use the session model's actual ID for that tier.

---

### Finding format rules

- **File + Risk** on one line — the reader knows instantly what breaks and why
  it matters before reading the proof.
- **Current code** block: verbatim lines from the diff, enough context to find
  the spot (3–10 lines). Never paraphrase — paste the actual code.
- **Why it's wrong**: lead with the failure mode ("this always returns false
  because…"), then the mechanism. Keep to 3–6 sentences. If a comparison or
  counter-example makes it clearer, include it.
- **Fix** block: show the corrected version as a drop-in replacement. When the
  fix is architectural (extract helper, add index), describe it concisely then
  show a minimal skeleton if useful. If the fix touches consumers outside the
  changed file, call that out explicitly — never show a partial fix that looks
  self-contained but silently breaks callers.
- Blank line between findings. No double blank lines.
- No trailing whitespace, no HTML tags, no ANSI escapes.
- **Proof counter-evidence rule**: when `proof.attempted` is true but `proven`
  is false because the code behaved correctly for the tested input, the
  synthesis MUST treat that as counter-evidence — either downgrade the finding
  or state in the finding body why the proof attempt doesn't exonerate it
  (e.g. the tested input wasn't the one that actually breaks). A finding whose
  proof came back green cannot silently stay Critical. When `attempted` is
  false, say nothing — untestable is not evidence either way.
