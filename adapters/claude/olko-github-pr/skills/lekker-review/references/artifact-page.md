# artifact-page.md -- lekker-review -- living web artifact procedure

Execute this procedure AFTER the review file has been saved to `~/code-reviews/`,
as part of the MAIN loop (not a reviewer/verifier agent). Skip the entire
procedure silently when `--no-artifact` was passed.

Claude Code publishes the review as a claude.ai Artifact page. OpenAI Codex
uses an already-available publish-capable artifact tool when one exists;
otherwise it writes a stable local HTML artifact under
`~/code-reviews/artifacts/`. The URL or stable local HTML path stays identical
across re-reviews of the same target, so findings can flip from open to fixed
without creating a new artifact identity.

---

## Step 1 -- Gather inputs

All of the following are already in hand after Step 3 of SKILL.md:

- `findings.json` path (scratchpad) -- each finding carries: `file`, `line`,
  `severity`, `title`, `description`, `badCode`, `fix`, `bugClass`,
  `otherInstances`, `rule?`, `precedent?`,
  `agreedBy?`, `verifierReasoning?`, `proof?` (proof = `{attempted, proven,
  outcome, reason, testCode?, testCommand?, redOutput?}`).
- The root `preExisting` array, when present, contains awareness-only bugs with
  `file`, `line`, `title`, `description`, `badCode`, and optional `dimension`.
- The saved review file path: `~/code-reviews/YYYY-MM-DD-pr-N-repo.md`.
- PR metadata: `REPO_SLUG`, `PR_NUMBER`, `PR_URL`, title, author, `headRefName`
  → `baseRefName`, head sha, depth, verdict, `isDraft`, `mergeStateStatus`, CI
  status.
- `PREV_ARTIFACT_TARGET` -- `null` on first review; on re-review, extracted
  from the prior review file's `**Artifact:** <target>` header line (SKILL.md
  Step 0 handles the extraction). A target is either an `http`/`https` URL or
  an absolute local artifact path.
- Since-last-review data when in re-review mode (fixed vs. still-open lists).
- The `--no-artifact` flag -- when set, skip this whole procedure silently.

---

## Step 2 -- Render for the current host

### Claude Code

The subagent RENDERS; the main loop PUBLISHES. Leaf agents run without the
Artifact tool (a renderer can write the page and then be unable to publish
it), so never ask the subagent to publish.

**Closer image (main loop, before launching):** when `CLOSER` is set, fetch its
image so the page can show it inline. The page CSP blocks external images but
not `data:` URIs.

```bash
# xkcd: the strip image (`img`); gif: the gif itself (`url`). Cap 500 KB, 10 s.
curl -sfL --max-time 10 --max-filesize 512000 -o <scratchpad>/closer-img <image url> \
  && [ "$(wc -c < <scratchpad>/closer-img)" -le 512000 ] \
  && echo "data:<image/png or image/gif>;base64,$(base64 < <scratchpad>/closer-img | tr -d '\n')" \
     > <scratchpad>/closer-datauri.txt
```

Pass `CLOSER_DATAURI_FILE=<scratchpad>/closer-datauri.txt` when that file
exists; otherwise omit it and the card stays link-only.

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

Follow the page specification below exactly. The <title> is
"Review: <repo-short> #<PR_NUMBER>". CLOSER=<closer JSON, or empty>.
CLOSER_DATAURI_FILE=<path, or empty>. Do NOT publish the page and do not look
for an Artifact tool: the caller publishes it.

Return ONLY the absolute path of the HTML file as your final text.

--- PAGE SPECIFICATION ---
<paste Step 3 verbatim here>
```

### OpenAI Codex

Use one native collaboration agent when a slot is available; otherwise the
coordinator renders the file after the review is saved. The renderer is a
bounded file-production task, not a review task. It reads only `findings.json`
and the saved review, follows the Step 3 page specification, and must not read
fresh secrets or context from the scratchpad.

Encode the complete repository identity before constructing a stable path:

```text
REPO_KEY = base64url(UTF-8(REPO_SLUG)), with trailing `=` padding removed
```

This encoding is filesystem-safe and injective: repositories with the same
short name but different owners cannot collide. Set the stable path from the
review target, not the date:

```text
~/code-reviews/artifacts/<REPO_KEY>-pr-<PR_NUMBER>.html
~/code-reviews/artifacts/<REPO_KEY>-branch-<sanitized-local-branch>.html
```

Choose the local render path and artifact result independently. When
`PREV_ARTIFACT_TARGET` is an absolute local path, validate that it is a regular
artifact path under `~/code-reviews/artifacts/` and reuse that exact path for
both values. Otherwise create the directory if needed and render to the
canonical path above. When `PREV_ARTIFACT_TARGET` is a validated `http` or
`https` URL, preserve that exact URL as the artifact result even if the current
host cannot publish; the canonical local path is only the render path and must
not replace the existing URL in the review header. Write one self-contained
HTML file using `apply_patch`, then re-read it. A re-review overwrites that
exact local file; never mint a second dated path for the same target.

Treat all PR metadata and every value read from `findings.json` as untrusted;
context-escape every dynamic value before HTML interpolation: escape `&`, `<`,
and `>` in HTML text and `<pre>` content, and additionally escape both quote
characters in attribute values. Parse every dynamic link target and permit it
in an `href` only when its scheme is exactly `http` or `https`; otherwise omit
the link and render escaped plain text. Never insert untrusted markup.

If a publish-capable artifact tool is already present, publishing is optional
and must preserve the previous URL. Do not install a service, create an account,
or publish publicly merely to obtain a URL. Without such a tool, keep a
validated previous URL as the artifact result; only when no previous URL exists
is the absolute local render path recorded in the review header.

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
  - body: description, `badCode` in a `<pre>`, `fix` in a `<pre>`, a
    "Bug class: `bugClass`" line followed by "Also at:" and each
    `otherInstances` entry as a `file:line` chip (omit "Also at:" when the
    list is empty), a small
    hard-rule chip (e.g. "TS-1 · hard rule") when `rule` is set, `agreedBy`
    chips when 2+ dimensions agreed, `verifierReasoning` as a muted footnote.
- **Proof block:** when `proof.proven === true`, render a visually distinct
  "PROVEN -- failing test ran in the worktree" panel: `redOutput` in a
  `<pre>`, a one-line explanation that the test asserts correct behavior, and
  `testCode` collapsed behind its own `<details>`. This is the page's
  centerpiece -- make it prominent (e.g. a red left border) but not garish.
  When `proof.outcome === 'passed'`, render a distinct
  "COUNTER-EVIDENCE -- focused proof test passed" panel with `reason`,
  `testCommand`, and `testCode` collapsed behind its own `<details>`. Explain
  that the workflow downgraded the finding to Important; do not present the
  passing input as proof that every related input is safe.
- **Test Quality + Review Cost sections**, mirrored from the review file,
  kept concise (verdict + gaps + cost table; no need to reproduce every
  sentence).
- **Pre-existing section:** when the saved review has `## Pre-existing`, render
  it as a separate, non-blocking section after Findings and before Test Quality.
  Preserve each `file:line`, one-sentence description, and quoted source line.
  Do not add these items to severity counts, finding totals, verdict badges,
  inline-comment links, or proof panels. Omit the section when empty.
- **Closer footer** (when the caller passes `CLOSER`): a small last card with
  the closer's title (or `alt`) as a link to its `url`. When
  `CLOSER_DATAURI_FILE` is set, read it and render
  `<img src="<its contents>" alt="<title or alt>">` above the link, at
  `max-width:100%; height:auto`. Never point `<img>` at an external URL: the
  CSP blocks it. Skip the card when `CLOSER` is empty.
- **Layout:** every code block (`badCode`, `fix`, `redOutput`, `testCode`)
  horizontally scrollable within its own container; the page body itself must
  never scroll horizontally. Keep total page weight sane -- plain `<pre>`
  with a theme-aware background, no syntax-highlighting library.
- **No praise language anywhere** (house rule, same as the saved review):
  state what the code does and the risks it carries, never compliment it.

---

## Step 4 -- Record the artifact target (fresh post-condition)

When the renderer completes (Claude Code: the subagent returns the HTML path):

1. Read the HTML file in full (the Artifact tool publishes only files that were
   read), and check that it has a `<title>` and no external `<img src="http`.
2. Publish with the Artifact tool: `file_path` = that path, `description` = one
   sentence ("Living code review for PR #<N>; findings update as commits
   land"), and `url: <PREV_ARTIFACT_TARGET>` ONLY when it is a validated `http`
   or `https` URL, so the same artifact updates in place. On a first publish
   add `icon: "review"`; omit `icon` on a republish so the page keeps its icon.

**On success (URL or stable local HTML path returned):**
1. Append or refresh a `**Artifact:** <target>` line in the saved review file's
   header block. Idempotent: replace an existing `**Artifact:**` line if
   present, never duplicate it.
2. Re-read the review file to confirm the line landed -- this is the receipt
   (per VERIFICATION.md: a write is not done until re-read from source).
3. Print one line to the user: `🔗 Living review: <target>`

**On failure (no URL, or the agent errored):**
- Say so in one line to the user.
- Do NOT fail or roll back the review over this -- the saved review file is
  the source of truth; the artifact is an enhancement layered on top of it.

---

## Hard rules

- Never delay printing the saved Markdown review for artifact rendering.
  Claude runs the renderer in the background. Codex may finish the stable local
  file after printing the review, but must not claim an artifact target until
  the file has been re-read successfully.
- Same target means the same URL or stable local HTML path, always. Carry
  `PREV_ARTIFACT_TARGET` whenever one exists. Pass it as `url` only when it is
  a validated `http` or `https` URL; when it is a validated local path, reuse
  that path directly. A new identity for a target that already has one is a
  bug.
- Published artifacts are private by default. A local artifact stays local;
  sharing either form is the user's decision, not the skill's.
- Never include secrets or tokens from context. The page contains only what
  the saved review file already contains -- nothing pulled fresh from
  scratchpad context that isn't already in the review.
- Set the artifact icon only on the first publish; never change it on
  republish.
