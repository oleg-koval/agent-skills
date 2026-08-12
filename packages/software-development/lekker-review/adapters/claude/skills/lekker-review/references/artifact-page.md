# artifact-page.md -- lekker-review -- living web artifact procedure

Execute this procedure AFTER the review file has been saved to `~/code-reviews/`,
as part of the MAIN loop (not a reviewer/verifier agent). Skip the entire
procedure silently when `--no-artifact` was passed.

This publishes the review as a claude.ai Artifact page whose URL stays STABLE
across re-reviews of the same PR -- the author watches findings flip from open
to fixed, commit after commit, at one link. Rendering is delegated to a single
background subagent so no session-model (Fable) tokens are spent writing HTML.

---

## Step 1 -- Gather inputs

All of the following are already in hand after Step 3 of SKILL.md:

- `findings.json` path (scratchpad) -- each finding carries: `file`, `line`,
  `severity`, `title`, `description`, `badCode`, `fix`, `rule?`, `precedent?`,
  `agreedBy?`, `verifierReasoning?`, `proof?` (proof = `{attempted, proven,
  reason, testCode?, testCommand?, redOutput?}`).
- The saved review file path: `~/code-reviews/YYYY-MM-DD-pr-N-repo.md`.
- PR metadata: `REPO_SLUG`, `PR_NUMBER`, `PR_URL`, title, author, `headRefName`
  → `baseRefName`, head sha, depth, verdict, `isDraft`, `mergeStateStatus`, CI
  status.
- `PREV_ARTIFACT_URL` -- `null` on first review; on re-review, extracted from
  the prior review file's `**Artifact:** <url>` header line (SKILL.md Step 0
  handles the extraction).
- Since-last-review data when in re-review mode (fixed vs. still-open lists).
- The `--no-artifact` flag -- when set, skip this whole procedure silently.

---

## Step 2 -- Launch the renderer subagent (background)

Launch exactly ONE `general-purpose` agent, `model: sonnet`, in the
background. Do not block printing the review on it (see Hard rules).

Brief template -- copy verbatim, filling in `<placeholders>`:

```
Load the `artifact-design` skill (Skill tool) FIRST -- mandatory before
writing any HTML.

Read the findings at <findings.json path> and the saved review at
<review file path>.

Write ONE self-contained HTML file to the session scratchpad:
review-pr-<PR_NUMBER>-<repo-short>.html

Follow the page specification below exactly. Then publish it with the
Artifact tool using:
  - favicon: "🥩"   (keep this IDENTICAL on every republish)
  - title: "Review: <repo-short> #<PR_NUMBER>"
  - description: <one sentence, e.g. "Living code review for PR #<N> --
    findings update as commits land">
  - url: <PREV_ARTIFACT_URL>   (include ONLY when non-null, so the SAME
    artifact updates in place instead of minting a new URL; omit the `url`
    parameter entirely on first publish)

Return ONLY the resulting artifact URL as your final text. No other output.

--- PAGE SPECIFICATION ---
<paste Step 3 verbatim here>
```

---

## Step 3 -- Page specification (the subagent's design contract)

Hard requirements for the HTML page:

- **Self-contained and theme-aware.** No external fonts/scripts/images/CDNs
  (CSP blocks them). Honor `prefers-color-scheme` as the default signal AND
  `:root[data-theme="dark"]` / `:root[data-theme="light"]` overrides.
- **Header card:** verdict badge (✅ LGTM / ⚠️ LGTM with changes / 🚫 Needs
  work -- color-coded), PR title linking to `PR_URL`, author, branch → base,
  head sha (short, `code` style), depth chip, findings count by severity, CI
  status. When `isDraft`: a DRAFT banner. When the PR title's ⛔ CANNOT MERGE
  block applies (see output-format.md): an unmissable banner above everything
  else on the page.
- **Timeline section (re-review mode):** "Since last review" -- one row per
  prior finding: ✅ fixed (title struck through) or ⚠️ still open, each with
  `file:line`. This is the living part of the page. On first review, show
  "First review of this PR" with the head sha and the review's date filled in
  from the review file (do not leave the date as a literal placeholder in the
  output).
- **Findings**, grouped Critical → Important → Observations → Idiomatic. Each
  finding is an expandable `<details>` block:
  - summary row: severity dot + title + `file:line`
  - body: description, `badCode` in a `<pre>`, `fix` in a `<pre>`, a small
    hard-rule chip (e.g. "TS-1 · hard rule") when `rule` is set, `agreedBy`
    chips when 2+ dimensions agreed, `verifierReasoning` as a muted footnote.
- **Proof block:** when `proof.proven === true`, render a visually distinct
  "PROVEN -- failing test ran in the worktree" panel: `redOutput` in a
  `<pre>`, a one-line explanation that the test asserts correct behavior, and
  `testCode` collapsed behind its own `<details>`. This is the page's
  centerpiece -- make it prominent (e.g. a red left border) but not garish.
- **Test Quality + Review Cost sections**, mirrored from the review file,
  kept concise (verdict + gaps + cost table; no need to reproduce every
  sentence).
- **Layout:** every code block (`badCode`, `fix`, `redOutput`, `testCode`)
  horizontally scrollable within its own container; the page body itself must
  never scroll horizontally. Keep total page weight sane -- plain `<pre>`
  with a theme-aware background, no syntax-highlighting library.
- **No praise language anywhere** (house rule, same as the saved review):
  state what the code does and the risks it carries, never compliment it.

---

## Step 4 -- Record the URL (fresh post-condition)

When the subagent returns:

**On success (URL returned):**
1. Append or refresh a `**Artifact:** <url>` line in the saved review file's
   header block. Idempotent: replace an existing `**Artifact:**` line if
   present, never duplicate it.
2. Re-read the review file to confirm the line landed -- this is the receipt
   (per VERIFICATION.md: a write is not done until re-read from source).
3. Print one line to the user: `🔗 Living review: <url>`

**On failure (no URL, or the agent errored):**
- Say so in one line to the user.
- Do NOT fail or roll back the review over this -- the saved review file is
  the source of truth; the artifact is an enhancement layered on top of it.

---

## Hard rules

- The renderer subagent runs in the BACKGROUND -- never block printing or
  delivering the review on its completion.
- Same PR → same URL, always. Pass `PREV_ARTIFACT_URL` whenever one exists. A
  fresh URL minted for a PR that already has one is a bug -- treat it as such
  if you spot it in the receipt.
- The artifact is private by default; sharing it is the user's decision, not
  the skill's.
- Never include secrets or tokens from context. The page contains only what
  the saved review file already contains -- nothing pulled fresh from
  scratchpad context that isn't already in the review.
- Favicon stays `🥩` forever for this artifact -- never change it on
  republish.
