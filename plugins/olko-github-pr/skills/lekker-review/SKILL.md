---
name: lekker-review
description: >
  FAANG-quality PR code review, adaptable to any team. Checks out the branch in an
  isolated worktree, gathers context from your issue tracker, chat, docs, CI
  checks, and (optionally) production monitoring, runs 5 parallel specialized
  review agents (quality/implementation/simplification/conventions/test-quality),
  verifies every verdict-affecting finding against the diff, then outputs a single unified markdown
  review: file + risk + bad code + why it's wrong + fix, ready to paste directly
  into GitHub. Saves every review to ~/code-reviews/*.md. Covers business logic,
  scalability, complexity, data integrity, security, integration contracts, error
  handling, and migration safety. Critical findings come with PROOF: a prover
  agent writes a failing test in the worktree demonstrating each bug, and fix
  mode later re-runs it to show the fix flips it green. Every review also
  publishes a private living artifact page whose URL stays stable across
  re-reviews, so the author watches findings close commit by commit.
  With --fix (or by accepting the post-review offer) it also APPLIES its own
  Critical/Important findings as real code in the worktree, verifies each edit,
  commits them, and pushes to the PR branch only after explicit confirmation.
  Also reviews a LOCAL BRANCH BEFORE IT IS PUSHED (`/lekker-review branch
  --fix`): same agents, same fixes, against the merge-base with the branch the
  PR would target, with no PR and no network round trip. Running it pre-push is
  how you stop paying bot reviewers like Greptile/CodeRabbit to find what this
  skill finds for free, so branch mode defaults to --fix and offers to open the
  PR when it is done.
  Use when the user says "review this PR", "lekker review", "check this PR",
  "do a code review on PR #N", "review and fix this PR", "apply the review
  fixes", "review my branch", "review before push", "check this before I open
  the PR", provides a GitHub PR URL, or asks for a pull request review in any
  form.
license: MIT
allowed-tools: Bash, Read, Write, Edit, Agent, Workflow, AskUserQuestion, Artifact
compatibility: >
  Claude Code only. Requires the Workflow tool (multi-agent orchestration)
  and the Artifact tool (living review page): other Agent Skills-compatible tools
  without an equivalent to Workflow cannot run the review/verify/critic pipeline this
  skill depends on. Requires git and gh (GitHub CLI) authenticated.
metadata:
  targets: [_source-only]
  author: Oleg Koval
  tags:
    - code-review
    - pull-request
    - github
    - multi-agent
    - workflow
    - quality
argument-hint: "<github-pr-url | repo pr-number | repo pr-title | branch [ref]> [scan|medium|deep] [--post] [--fix] [--base <ref>]"
---

# Lekker Review

FAANG-grade code review. Isolated worktree checkout, full context gathering
(issue tracker + chat + docs + framework docs + monitoring + CI, whichever
you have MCP tools configured for), then 5 parallel specialized review
agents, a finding-verification pass, and one unified markdown output.

Two modes, same review engine:

| Mode       | Target                              | Entry                                  |
|------------|-------------------------------------|-----------------------------------------|
| **pr**     | An open GitHub PR                   | a PR url / `repo N` / `repo "title"`   |
| **branch** | A local branch, before it is pushed | `branch [ref]`, or `--branch`          |

Branch mode exists to move the review left: everything a bot reviewer
(Greptile, CodeRabbit, or similar) would charge for on the PR is found and
FIXED locally first, so the PR opens clean and there is little left to bill
for. It reviews the same diff a PR would show - merge-base against the branch
the PR would target - and it defaults to `--fix`.

Each finding contains: **file + risk** · **bad code verbatim** · **why it's
wrong** · **fix with code example** - ready to paste directly into GitHub.
Reviews are saved to `~/code-reviews/` for future reference.

Optionally the skill then **applies** its own findings (`--fix`): fix agents edit
the worktree, a read-only verifier checks each edit against the real `git diff`,
static checks run, one commit lands per file, and nothing is pushed until the
user says so. Procedure in `references/fix-mode.md`.

No nitpicking. Critical and Important findings are reserved for things that
could cause bugs, outages, data loss, security incidents, or real performance
problems at scale.

**HARD RULE: the `## 💰 Review Cost` block is mandatory.** Every review MUST
end with a fully-populated cost block (token + price breakdown, real numbers,
no `<N>` placeholders). A review without the cost block is incomplete. If you
are about to present the review without it, stop and compute it first.

---

## Set up before first use

This skill ships with **no** hard rules of its own: `references/house-rules.md`
is a template. Fill it in with your team's own non-negotiable conventions
(type safety, pagination, PR-title format, repo-placement taxonomy, stack
context) before relying on the Critical-severity hard-rule gate. Until then,
the 5 specialist agents still run and still find real bugs. They just don't
have a codified "always Critical" rule list to check against.

If any hard rule you define carries a `rule` tag (e.g. `"TS-1"`), reviewer
agents attach that tag to matching findings. The verifier checks the diff
anchor and rule applicability, but skips its five runtime-failure challenges.
Those challenges cannot evaluate a standards violation. A tagged finding keeps
Critical severity only when both rule-specific checks pass. The workflow
returns the number checked as `hardRuleCount`.

`${CLAUDE_PLUGIN_ROOT}` below refers to this skill's own installed directory:
resolve every `references/...` and script path relative to it.

---

## Step 0 - Parse input

### Pick the mode first

`MODE=branch` when ANY of these hold:
- the argument is the literal word `branch` (optionally followed by a ref), or
  the flag `--branch [ref]` is present
- the user asked for a review "before push", "before the PR", "of my branch",
  "of these commits", or named a local branch that has no open PR
- no PR reference was given at all and `$PWD` is inside a git repo on a branch
  that is not the base branch

Otherwise `MODE=pr`.

Never guess between the two. If a PR reference is present, it is `pr` mode
even in a git repo. If neither a PR reference nor a git repo is available,
stop and ask - do not review the wrong thing.

### MODE=pr

Accept any of:
- Full GitHub URL: `https://github.com/owner/repo/pull/123`
- Repo + number: `my-service 42`
- Repo + partial title: `my-service "add offline orders"`

If the user gives a short repo name without an org/owner, ask once which
org/owner it belongs to (or use a default you've configured), then build
`REPO_SLUG` as `<owner>/<name>`.

Derive and carry these variables through every subsequent step:
- `REPO_SLUG` (e.g. `my-org/my-service`)
- `PR_NUMBER`
- `PR_BRANCH` (from `gh pr view`)
- `PR_URL` = `https://github.com/<REPO_SLUG>/pull/<PR_NUMBER>`
- `TARGET_LABEL` = `PR #<PR_NUMBER>`

### MODE=branch

Resolve everything from the local repo - no `gh pr` call, no network:

```bash
LOCAL_REPO=$(git -C "$PWD" rev-parse --show-toplevel)
LOCAL_BRANCH=$(git -C "$LOCAL_REPO" rev-parse --abbrev-ref HEAD)   # or the ref the user named
REPO_SLUG=$(git -C "$LOCAL_REPO" remote get-url origin \
  | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
```

Then:
- `BASE_REF`: the branch the PR would target. Honour `--base <ref>` when given.
  Otherwise let `scripts/changed-files.sh` detect it (origin's default branch,
  then whatever your convention falls back to) and report which one it picked.
  If detection lands on something that contradicts your team's actual
  convention, say so in the review header rather than reviewing silently
  against the wrong base.
- `PR_NUMBER` = null, `PR_URL` = null, `TARGET_LABEL` = `branch <LOCAL_BRANCH>`.
- The reviewed diff is `merge-base(HEAD, BASE_REF)..HEAD` - committed work only.
  **Uncommitted and untracked changes are NOT reviewed.** If `git status
  --porcelain` is non-empty, say so in one line before starting
  (`⚠️ N uncommitted file(s) are not part of this review`) so nobody assumes
  coverage that does not exist.
- If that diff is empty, stop: `nothing to review - <branch> matches <base>`.

**Guard:** never run branch mode on a long-lived integration branch. If
`LOCAL_BRANCH` is `main`, `master`, `develop`, `staging`, or `production`, stop
and say so.

**Depth:** explicit keyword `scan`, `medium`, or `deep` wins. If absent, get
the diff stat - in `pr` mode from
`gh pr view <PR_NUMBER> --repo <REPO_SLUG> --json additions,deletions,changedFiles`,
in `branch` mode from `git diff --shortstat <MERGE_BASE> HEAD` plus
`git diff --name-only <MERGE_BASE> HEAD | wc -l` - and apply AUTO-DEPTH:
- `scan` if additions+deletions < 150 AND changedFiles <= 5
- `deep` if additions+deletions > 800 OR changedFiles > 25 OR diff touches
  `migrations/` or `*.sql`
- `medium` otherwise

State the chosen depth (and whether it was auto-selected) in the review header.

**`--post` flag:** parse and store as `POST_REVIEW=true`.

**`--fix` flag:** parse and store as `FIX_MODE=true`. Fix mode needs a real
checkout, so `--fix` forces Track A (worktree setup) to run even when
depth=scan. If the user did NOT pass `--fix`, leave `FIX_MODE=false` for now -
Step 4 offers it after the review is printed.

**Branch mode defaults to fix.** In `MODE=branch`, `FIX_MODE=true` and
`FIX_SCOPE=critical+important` unless the user passed `--no-fix`. That is the
whole point of reviewing pre-push: findings get applied before the PR exists,
so a bot reviewer never sees them. Landing those fixes on the local branch
still needs explicit confirmation (Step 4).

**`--base <ref>` flag (branch mode only):** overrides base-ref detection. Passed
through to the scripts as `LEKKER_BASE_REF`. Ignored in `pr` mode, where the
base comes from the PR.

**`--no-fix` flag:** parse and store as `FIX_MODE=false`, and do not offer fixes
in Step 4. Use it for a read-only pre-push look.

**`--no-artifact` flag:** parse and store as `ARTIFACT=false` (default true).
Skips Step 3.5 (living review artifact) silently.

**Re-review detection:** run
`ls ~/code-reviews/*-<TARGET_SLUG>-<repo-short-name>.md 2>/dev/null | sort | tail -1`
(`TARGET_SLUG` = `pr-<PR_NUMBER>` in pr mode, `branch-<LOCAL_BRANCH sanitized to
[a-z0-9-]>` in branch mode)
to find the newest prior review for this PR (repo-short-name = last segment of
REPO_SLUG; keeps PR numbers from colliding across repos). If found, grep it for
`\*\*Head:\*\*` and extract the short sha. Set `PREV_SHA=<sha>` and
`PREV_REVIEW_FILE=<path>`. If no Head line exists in the file (older format),
treat as a full review and leave PREV_SHA unset. Also grep the same file for
`\*\*Artifact:\*\*` and set `PREV_ARTIFACT_URL=<url>` (null when absent) - Step
3.5 republishes to the SAME url so the artifact stays a living page for this PR.

---

## Depth gate

| Step                        | scan                  | medium              | deep                       |
|-----------------------------|-----------------------|---------------------|----------------------------|
| Context: issue-tracker/CI/diff/existing-reviews | always | always | always |
| Context: chat/docs/framework-docs/monitoring/prior-review-memory (optional, MCP-dependent) | skip | included | included + broader recall |
| Worktree + static checks    | skip (WORKTREE_PATH=null) unless `--fix` | included | included          |
| Review agents               | 2 triage (haiku)      | 5 specialists (sonnet) | 5 specialists (sonnet)  |
| Per-finding verification    | Criticals + Importants | Criticals + Importants | Criticals + Importants |
| Completeness critic         | skip                  | skip                | included                   |
| Proof-of-bug (failing test per Critical) | skip     | included (max 5)    | included (max 5)           |
| Living review artifact      | included              | included            | included                   |
| Housekeeping (optional memory/notes writeback) | skip | included            | included                   |
| `--post`                    | supported             | supported           | supported                  |
| `--fix` / fix offer         | supported (forces worktree) | supported     | supported                  |

For scan: note `⚡ scan - worktree unavailable, static checks skipped` in the
review header. When `--fix` forced the worktree at scan depth, drop that note
and say `⚡ scan - worktree created for --fix` instead.

**Branch mode always has a worktree** (fix mode is the default, and there is no
remote diff to fall back on), so the scan row's "skip worktree" never applies.
Everything else in the table is unchanged: branch mode is not a shallower
review, it is the same review earlier. Two rows differ because their inputs do
not exist yet:

| Step                     | branch mode                                                  |
|--------------------------|--------------------------------------------------------------|
| CI checks                | `N/A - not pushed`; local compiler/linter/tests are the only signal |
| Existing bot reviews     | none by definition - that is the saving                        |
| `--post`                 | unsupported until a PR exists (Step 4.6 can create one)        |

---

## Step 1 - Context + worktree (concurrent)

Fire both tracks in the same turn.

### Track A - worktree setup (skip when depth=scan, unless `--fix`)

Run via Bash with `run_in_background`:

```bash
# MODE=pr - checks out origin/<PR_BRANCH>, fetching if needed
${CLAUDE_PLUGIN_ROOT}/scripts/setup-worktree.sh \
  <REPO_SLUG> <PR_BRANCH> <scratchpad>/worktree.json [PREV_SHA]
```

```bash
# MODE=branch - LOCAL ref only. LEKKER_LOCAL_REPO skips repo discovery, the
# fetch, and the origin/<branch> checkout entirely, and creates the worktree
# DETACHED so a branch already checked out in the user's own working copy can
# still be reviewed. LEKKER_BASE_REF is set only when --base was given.
LEKKER_LOCAL_REPO=<LOCAL_REPO> [LEKKER_BASE_REF=<BASE_REF>] \
${CLAUDE_PLUGIN_ROOT}/scripts/setup-worktree.sh \
  <REPO_SLUG> <LOCAL_BRANCH> <scratchpad>/worktree.json [PREV_SHA]
```

On completion, read `worktree.json`. Keys emitted:
`worktreePath`, `repoRoot`, `headSha`, `headShaShort`, `tscTail`,
`tscChangedTail`, `tscErrorCount`, `eslintTail`, `eslintScope`, `changedFiles`,
`baseRef`, `mergeBase`, `projectRules`, `deltaFile`, `notes`.

`mergeBase` is the commit the file list was scoped against. Branch mode
generates its diff from that exact sha (below), so the diff the agents read and
the files the static checks were scoped to can never disagree. `notes` contains
`local-branch-mode;` when the local path ran.

Static checks are scoped so you can tell this PR's errors from the repo's
standing debt - do not try to infer that from the raw tail:

- `eslintTail` is the result of linting only `changedFiles` (`eslintScope` says
  `changed-files`). Everything in it belongs to this PR. When `eslintScope` is
  `full-fallback`, base-ref detection failed and the lint is repo-wide again -
  in that case treat its contents as unattributed and say so rather than
  blaming the author.
- `tscTail` is the raw repo-wide tail (tsc needs the whole program, so it cannot
  be scoped). `tscChangedTail` holds only the errors in files this PR touched -
  that is the attributable set. `tscErrorCount` is the repo-wide total; a large
  count with an empty `tscChangedTail` means pre-existing debt, not a finding.
- If your stack doesn't use tsc/eslint, adapt `setup-worktree.sh`'s static
  check step to your language's compiler/linter equivalents.

A failing CI build or test = Critical finding input.

When depth=scan: set `WORKTREE_PATH=null` without launching the script - unless
`FIX_MODE=true`, in which case run the script anyway (fix mode cannot edit code
from a diff). In `MODE=branch` the script always runs, at every depth.

A failing local compiler/linter/test run in branch mode is the direct
replacement for the failing-CI signal - treat it exactly the same way. Catching
it here is a CI run the PR never has to burn.

### Track B - metadata and signals (all calls fired in parallel)

Run ALL of the following in the same message. Full query details are in
`references/context-gathering.md` - follow it, do not paste it wholesale into
agent contexts.

**In `MODE=branch`, every `gh pr *` call below is skipped** - there is no PR.
Wait for Track A's `worktree.json` (you need `mergeBase`), then substitute:

```bash
# The diff, from the SAME merge-base the file list was scoped to.
git -C <worktreePath> diff <mergeBase> HEAD > <scratchpad>/pr.diff

# Commit log, for ticket ids and for the PR title the branch would need.
git -C <worktreePath> log --format='%s%n%b' <mergeBase>..HEAD
```

- The title/ticket-prefix check in branch mode is a PRE-check, not a
  violation: scan the commit subjects for your team's ticket pattern, collect
  the distinct ids, and set `RECOMMENDED_PREFIX`. There is no PR title to be
  wrong yet, so `PR_TITLE_ISSUE=false` - report the prefix as the title to use,
  in the Step 4.6 PR offer.
- Ticket ids come from the commit log and the branch name instead of the PR
  title/body; the issue-tracker lookup below is otherwise identical.
- `ciStatus` = `N/A - not pushed`. `existingReviews` = null.
- Everything else in Track B (issue tracker, chat, docs, framework docs,
  monitoring, prior-review memory) runs unchanged, keyed off the ticket ids
  and the branch name.

`MODE=pr` calls:

- `gh pr view <PR_NUMBER> --repo <REPO_SLUG>` with fields: `number`, `title`,
  `body`, `author`, `headRefName`, `baseRefName`, `labels`, `linkedBranches`,
  `mergeStateStatus`, `additions`, `deletions`, `changedFiles`, `isDraft`,
  `headRefOid`. Extract `headRefOid` (full sha) and `headShaShort` (first 7).
- Title/ticket-prefix check (if `house-rules.md` defines one): scan commit log
  for the ticket pattern; set `PR_TITLE_ISSUE` and `RECOMMENDED_PREFIX`.
- `gh pr diff <PR_NUMBER> --repo <REPO_SLUG> > <scratchpad>/pr.diff` - fetched
  ONCE; all agents read this file via `DIFF_FILE`.
- `gh pr checks <PR_NUMBER> --repo <REPO_SLUG>`
- `gh pr reviews <PR_NUMBER> --repo <REPO_SLUG>` and review comments
- Issue-tracker lookup (Linear/Jira/GitHub Issues MCP, if configured) per
  ticket ID found in title/body/branch; collect ACs as numbered list (`acList`).
- (medium/deep only, optional) Chat search (Slack/Discord MCP, if configured):
  PR-title keywords and ticket ID.
- (medium/deep only, optional) Docs search (Notion/Confluence/wiki MCP, if
  configured): feature name or ticket title.
- (medium/deep only, optional, only when relevant) Framework/API docs MCP for
  the specific framework or third-party API the diff touches.
- (medium/deep only, optional) Monitoring search (Sentry/Rollbar/etc. MCP, if
  configured) for filenames or service names from the diff.
- (medium/deep only, optional) Prior-review-memory recall, if you maintain
  such a system: patterns and false positives specific to this repo.

### Assemble CONTEXT_FILE

Write `<scratchpad>/context.json` with keys:

```json
{
  "acList":          "<numbered ACs from your issue tracker, or empty>",
  "projectRules":    "<worktree.json projectRules + any recalled review patterns appended under '## Recalled patterns'>",
  "sentrySignals":   "<monitoring issue summaries, or null>",
  "ciStatus":        "<passing | failing: <names> | pending | N/A>",
  "existingReviews": "<prior review summaries>",
  "deltaFile":       "<worktree.json deltaFile, or null>",
  "houseRulesFile":  "${CLAUDE_PLUGIN_ROOT}/references/house-rules.md",
  "reviewTarget":    "<TARGET_LABEL, e.g. 'PR #412' or 'branch feat/offline-orders'>",
  "prePush":         "<true in MODE=branch, false in MODE=pr>"
}
```

`prePush: true` tells the agents there is no CI verdict and no bot review to
defer to, and that anything they flag is cheaper to fix now than after the PR
opens. It does NOT lower the bar: same severities, same no-nitpicking rule.

Agents read keys from this file. Nothing from CONTEXT_FILE is pasted into
their prompts wholesale - the workflow script delivers it by path.

---

## Step 2 - Workflow (review + verify + critic)

Invoke the Workflow tool:

```
scriptPath: ${CLAUDE_PLUGIN_ROOT}/workflow.js
args: {
  repoSlug,
  prNumber,          // null in MODE=branch
  prUrl,             // null in MODE=branch
  targetLabel,       // TARGET_LABEL - REQUIRED when prNumber is null
  depth,
  diffFile:    "<scratchpad>/pr.diff",
  contextFile: "<scratchpad>/context.json",
  worktreePath: <null for scan, else from worktree.json>,
  promptDir:   "${CLAUDE_PLUGIN_ROOT}/references/agents",
  prevSha:     <null unless re-review>
}
```

`targetLabel` is what every agent is told it is reviewing. The workflow falls
back to `PR #<prNumber>` when it is absent, so pr mode may omit it; branch mode
must pass it, or the workflow throws on its missing-args guard.

Two optional args tune concurrency; omit both unless a run needs it:

- `reviewBatchPlan` - batch sizes for the review dimensions, default `[5]`
  (all five at once). The last entry repeats to cover any remainder, so
  `[2]` would mean two at a time.
- `maxConcurrent` - cap for the per-finding fan-outs (verify, critic, prove),
  default `5`.

Lowering them is always safe: it costs wall-clock, never findings. Reach for
that only when a specific run needs a smaller footprint.

The workflow runs three phases:

- **Review:** scan uses `[triage-quality, triage-logic]` on `haiku`; medium/deep
  use 5 specialists (quality, implementation, simplification, conventions,
  test-quality) on `sonnet`. Agents receive DIFF_FILE + CONTEXT_FILE by path.
  All five run concurrently: the stage is self-limiting at one agent per
  dimension. All reviewers run to completion before verification starts.
  Override per run with the `reviewBatchPlan` arg (e.g. `[1]` runs them
  strictly one at a time on a constrained machine).
- **Dedup:** findings are merged across dimensions on `file:line` + title
  token-similarity, so one issue found by three agents is verified once, not
  three times. A merge keeps the highest severity and the longest
  description/badCode/fix of the set - a Critical is never demoted by an
  Observation someone else filed at the same line - and records every
  contributing dimension in `agreedBy`.
- **Verify:** every Critical and Important is checked at every depth because it
  can affect the verdict. Hard-rule findings (`rule` set) use the verifier's
  diff-anchor and rule-applicability checks instead of runtime challenges.
  Each verifier runs the five-challenge adversarial refutation from
  `references/agents/verifier.md` against one finding, returns
  `{verdict, newSeverity?, reasoning}`. Verifiers run `maxConcurrent` at a time
  (default 5): this stage spawns one agent PER FINDING, so without a ceiling a
  thirty-finding PR launches thirty concurrent agents.
- **Critic (deep only):** completeness critic gets the full deduped finding
  list + DIFF_FILE; its findings go through verifier agents before promotion.
- **Prove (medium/deep, worktree required):** each non-hard-rule Critical gets
  one prover agent (`references/agents/prover.md`, sonnet, max 5, run
  `maxConcurrent` at a time) that writes a test asserting the CORRECT behaviour,
  runs it in the worktree, and captures it failing because of the bug. The proof rides on the finding as
  `proof: {attempted, proven, outcome, reason, testCode?, testCommand?, redOutput?}`.
  A proof that comes back GREEN (code behaved correctly) is counter-evidence -
  the workflow automatically downgrades the finding from Critical to Important.
  Hard-rule findings are never proved (policy violations have no failing test).

Findings have schema:
`{file, line, severity, title, description, badCode, fix, rule?, precedent?, agreedBy?, verificationStatus?, verifierReasoning?, proof?}`
`badCode` and `fix` are schema-required: an empty string is allowed only on
`observation` / `idiomatic` findings.

Model tiers: triage on `haiku`, specialists on `sonnet`, verifiers + critic +
provers on `sonnet`, housekeeping on `haiku`. Only the synthesis in Step 3 runs
on the session model.

Return value from the workflow:
`{findings, droppedCount, downgradedCount, hardRuleCount, proveAttemptCount, provenCount, acCoverage, coverageVerdict, mutationSlip, mockSmells, agentCount, outputTokens, turnTokensTotal}`
`outputTokens` is this workflow's own output spend; `turnTokensTotal` is the
whole turn's shared pool (main loop included).

Wait for the workflow to complete before proceeding to Step 3.

---

## Step 3 - Synthesize and output

**Mindset:** the author's name is not evidence. Bot review scores are not
anchors. Apply your own judgment to every finding.

**Do NOT flag:**
- Style preferences or naming taste where no convention is violated
- Comment wording choices
- Scenarios requiring multiple simultaneous unrealistic failures
- Tiny DRY opportunities (2-3 duplicated lines)
- Pre-existing code not touched by this diff
- Anything you are not confident about - omit rather than hedge

**Approval standard.** The verdict answers "does this definitely improve the
codebase's health", not "is this how I would have written it". Perfect code does
not exist. `✅ LGTM - ship it` is the right call for a change that improves
health and violates no hard rule, even with open Observations or Idiomatic
findings. Reserve `🚫 Needs work` for an unfixed Critical, a hard-rule
violation, or an Important finding that changes external behaviour or data
shape. Never manufacture a Critical to justify a verdict, and never block on
taste.

**PR sizing.** Judge how much a reviewer must hold at once, not the raw diff
count:
- Under ~300 changed lines, or larger but one logical change: no finding.
- Over ~800 changed lines spanning more than one logical change: `important`,
  and name the split. Pick the strategy that fits - stack (sequential
  dependencies), by file group (different reviewers), horizontal (shared code
  and stubs first, then consumers), vertical (smaller full-stack slices).
- A diff that both refactors existing code and adds new behaviour: `important`
  at any size. Those are two PRs, and bundling them hides the real change.
- A change that pushes a single file past ~1000 total lines with no
  decomposition: `observation`. Ask for the extraction first, then the feature.
Exempt: whole-file deletions and mechanical or automated refactors, where the
reviewer verifies intent rather than every line.

**Verify the verification.** Read the PR body for the author's verification
story: which tests were run, whether the build passed, whether it was exercised
manually, screenshots for a UI change, a before/after for a behaviour or
performance change. A non-trivial PR whose body claims nothing about
verification is an `observation` naming the evidence that is missing. `CI: ✅
All passing` is not a verification story - it only says the suite that already
existed still runs.

**Rationalizations to reject.** If one of these is the reason a finding is about
to be dropped or softened, keep the finding:

| Rationalization | Reality |
|---|---|
| "The tests pass, so it's fine" | Tests do not catch architecture, security, or data-shape problems. |
| "It works, that's good enough" | Working code that is unreadable or insecure is debt that compounds. |
| "The refactor makes it cleaner" | Relocating complexity is not reducing it. Count the concepts a reader holds. |
| "It's only a small addition to this file" | Judge the resulting structure, not the diff size. |
| "It's just a version bump" | A bump is a behaviour change nobody in the PR wrote. |
| "They'll clean it up later" | Later does not come. Require it now, or require a ticket. |
| "An agent wrote it, so it's probably fine" | Generated code needs more scrutiny, not less: it is confident and plausible when wrong. |

**Idiomatic & Consistency exception:** the conventions agent raises non-blocking
suggestions ONLY when a concrete better pattern provably already exists in the
codebase. Never on taste alone. These land in their own section, not in
Critical/Important. A finding without a cited precedent from the codebase is
dropped.

**Format** the review per `references/output-format.md` (read it now). Key
requirements:

- Header must include `**Head:** <headShaShort>` (enables future delta mode).
- **Branch mode header:** title the review `Pre-push review - <LOCAL_BRANCH>`,
  and include `**Target:** branch <LOCAL_BRANCH> -> <BASE_REF> (not pushed)`,
  `**Base:** <mergeBase short sha>`, and `**CI:** N/A - not pushed`. State the
  uncommitted-file warning here if `git status --porcelain` was non-empty.
  There is no PR link and no bot-review section; do not invent either.
- When `isDraft=true`: add `**DRAFT PR** - findings recorded for when this
  is ready to merge.` after the header block.
- When `mergeStateStatus` is not CLEAN: note it (e.g. conflicts, failing
  required checks).
- When `PR_TITLE_ISSUE=true`: insert the `⛔ CANNOT MERGE` block before the
  Summary. In branch mode there is no title yet, so instead print one line -
  `**PR title to use:** <RECOMMENDED_PREFIX> <summary>` - and carry it into
  the Step 4.6 offer.
- When `sentrySignals` is non-empty: include `## 🔥 Production Signals`.
- When `PREV_SHA` is set: include `## 🔁 Since last review` comparing
  `PREV_REVIEW_FILE` findings against the new head - list each as fixed or
  still open, before any new findings.
- Test Quality section: populate from the workflow return fields
  (`coverageVerdict`, `mutationSlip`, `mockSmells`).
- Idiomatic section: populated from severity=idiomatic findings only.
- **💰 Review Cost block:** `outputTokens` from the workflow return is the
  ACTUAL output spend of the review workflow's own agents. `turnTokensTotal` is
  the whole turn's shared pool - report it separately, never as the workflow's
  cost. Input tokens are estimated (diff tokens x agent passes + context
  + prompt files). Use the pricing table in `references/output-format.md`.
  Real numbers only - no `<N>` placeholders.

**Save the review:**

```bash
mkdir -p ~/code-reviews
# TARGET_SLUG: "pr-<PR_NUMBER>" in pr mode,
#              "branch-<LOCAL_BRANCH sanitized to [a-z0-9-]>" in branch mode
REVIEW_FILE=~/code-reviews/$(date +%Y-%m-%d)-<TARGET_SLUG>-<repo-short-name>.md
# write the review to $REVIEW_FILE
```

After writing, re-read the file and emit a receipt:
`✓ Review saved -> <path>`

Also write the workflow's `findings` array verbatim to
`<scratchpad>/findings.json` - fix mode reads its selection from there (the
`proof` objects ride along for the Step 5b proof flip), and it is the receipt
that what was reported equals what was found.

**Branch mode also drops a review marker**, so a pre-PR gate you build on top
of this skill can tell a reviewed branch from an unreviewed one:

```bash
mkdir -p ~/.cache/lekker-review/reviewed
printf '%s\n' "$REVIEW_FILE" > ~/.cache/lekker-review/reviewed/<headSha>
```

Write it against the sha that was actually reviewed. When fix mode later adds
commits, write a marker for the NEW head sha too - a gate keys on the tip
that is about to be pushed, and a marker for a superseded sha would be a lie.

Then print the full review as the response.

---

## Step 3.5 - Living review artifact (skip when ARTIFACT=false)

Immediately after printing the review, follow `references/artifact-page.md`:
launch ONE background sonnet agent that renders the review as a self-contained
HTML page and publishes it via the Artifact tool - passing `PREV_ARTIFACT_URL`
when set, so a re-review UPDATES the same page instead of minting a new URL.
The page is the living version of the review: verdict header, since-last-review
timeline, findings with proof panels, all private by default.

Never block on it: the printed review and the saved file are the deliverable;
the artifact is an enhancement. When the URL comes back, append/refresh the
`**Artifact:** <url>` header line in the saved review file (re-read to confirm)
and print one line: `🔗 Living review: <url>`.

---

## Step 4 - Fix mode (after the review is printed)

### Trigger

- `FIX_MODE=true` (the user passed `--fix`, or `MODE=branch` defaulted it on)
  -> go straight to `references/fix-mode.md`.
- `FIX_MODE=false` and at least one Critical or Important finding has a `fix`
  field -> ask once, via AskUserQuestion:

  > Apply these fixes to the PR branch?
  > - **Critical + Important** (N findings) - fix agents edit the worktree,
  >   verified, committed; push needs your confirmation
  > - **Critical only** (N findings)
  > - **No, review only**

  Set `FIX_MODE=true` and `FIX_SCOPE=<critical+important | critical>` from the
  answer. On "No", skip to Step 5.
- No fixable findings, or the review found nothing -> do not ask. Say
  `nothing to auto-fix` in one line and skip to Step 5.
- **Unattended run** (cron, `/loop`, background agent): never ask. Run fix mode
  only when `--fix` was passed explicitly, and stop before pushing (branch mode:
  stop before landing).

### Procedure

Read `references/fix-mode.md` and follow it. Shape of the run:

1. Preconditions.
   - `MODE=pr`: worktree exists + clean, `origin/<PR_BRANCH>` still at
     `headSha`, PR open, head repo writable.
   - `MODE=branch`: worktree exists + clean, and `refs/heads/<LOCAL_BRANCH>` in
     `repoRoot` is still at `headSha`. If the branch moved while the review ran,
     stop - do not land onto a tip you did not review.
2. Select eligible findings (Critical/Important with a `fix`, real file,
   non-generated). Never auto-fix Observation, Idiomatic, or a title/process rule.
3. Invoke the fix workflow:
   ```
   scriptPath: ${CLAUDE_PLUGIN_ROOT}/fix-workflow.js
   args: { repoSlug, prNumber, targetLabel, worktreePath, diffFile, contextFile,
           promptDir, findings: [<selected findings verbatim>] }
   ```
   `targetLabel` is required whenever `prNumber` is null, same as the review
   workflow.
   One `sonnet` fix agent per file (never two on the same file), then a
   read-only `sonnet` fix-verifier per file reading the actual `git diff`. One
   retry max on a non-`good` verdict.
4. Revert every group the verifier did not pass.
5. Run `scripts/verify-fixes.sh <WORKTREE_PATH> <scratchpad>/fix-verify.json tests`
   and diff the output against the baseline `tscTail`/`eslintTail` from
   worktree.json. Newly introduced errors -> revert that group.
5b. Proof flip: for findings with `proof.proven`, re-run the captured failing
   test after the fix. Still red -> the fix did not fix the bug: revert the
   group even if the fix-verifier said `good`. An executed test outranks an
   agent's opinion. Green -> record `proofFlip: green` in the status table.
6. Commit one commit per file with an explicit `git add -- <files>`.
7. Land the commits, ONLY after the user confirms.
   - `MODE=pr`: `git push origin HEAD:refs/heads/<PR_BRANCH>` with a re-fetch
     sha guard. Never force, never rebase, never push to
     main/master/staging/develop. Verify via `gh pr view --json headRefOid`.
   - `MODE=branch`: nothing is pushed - the fixes move onto the LOCAL branch, so
     the work is one branch again before it ever reaches the remote.

     ```bash
     # Fast-forward the local branch onto the reviewed-and-fixed worktree tip.
     # --ff-only and the old-value guard together mean this can only ever
     # advance the exact commit the review started from.
     git -C <repoRoot> update-ref refs/heads/<LOCAL_BRANCH> <worktreeHeadSha> <headSha>
     ```

     If `<LOCAL_BRANCH>` is the branch checked out in `repoRoot`, `update-ref`
     would leave the user's working tree looking like it had deleted the fixes.
     In that case require a clean `git -C <repoRoot> status --porcelain` and use
     `git -C <repoRoot> merge --ff-only <worktreeHeadSha>` instead. If the tree
     is dirty, stop, keep the worktree, and print the exact command - never
     stash or discard someone's uncommitted work.

     Verify with `git -C <repoRoot> rev-parse refs/heads/<LOCAL_BRANCH>` and
     confirm it equals `<worktreeHeadSha>`. Then refresh the review marker for
     the new sha (Step 3).
8. Print the per-finding status table and append `## 🔧 Fixes applied` to the
   saved review file.

Fix-agent tokens are additional spend: add a `Fix agents:` line to the
`## 💰 Review Cost` block.

---

## Step 4.6 - Open the PR (MODE=branch only)

Skip entirely in `MODE=pr`.

The branch has now been reviewed and, where it had fixable findings, fixed. The
PR is the next step, but it is the USER'S call and it is the one irreversible
thing in this whole flow - once the PR exists a bot reviewer may start running
and start costing money. **Never create it silently.**

Ask once, via AskUserQuestion:

> Branch reviewed<, N fixes applied>. Open the PR now?
> - **Yes, create the PR** - `<RECOMMENDED_PREFIX>` title, base `<BASE_REF>`,
>   pushes `<LOCAL_BRANCH>` first
> - **Push the branch only** - no PR yet
> - **No, stop here** - nothing leaves this machine

Rules for each answer:

- **Yes:** `git push -u origin <LOCAL_BRANCH>`, then create the PR yourself with
  `gh pr create --repo <REPO_SLUG> --base <BASE_REF> --head <LOCAL_BRANCH>
  --title "<RECOMMENDED_PREFIX> <summary>" --body "<body>"`. Derive the title
  from the commit log (the recommended prefix plus a summary of the change) and
  the body from a short summary of what the branch does - do not leave either
  as a placeholder. Report the PR url. The review is already saved locally;
  offer `--post` on the new PR number only if the user asks - findings that fix
  mode already applied must never be posted as review comments.
- **Push only:** `git push -u origin <LOCAL_BRANCH>` and stop. Say in one line
  that no PR was created.
- **No:** stop. Print the branch name and the review file path.

**Unattended runs never ask and never create a PR** (see the operating contract
for your host: with no human present, "ask for confirmation" means stop and
report). Stage the branch, print what would have happened, and stop.

If the review verdict is `🚫 Needs work` with an unfixed Critical, say so in the
question - opening a PR on a known-broken branch just moves the finding to
whoever reviews it next.

---

## Step 5 - Post-review (after the review and any fixes)

### If POST_REVIEW=true

In `MODE=branch` there is no PR to post to. If `--post` was passed, say
`--post ignored - no PR yet` in one line and skip this section, unless Step 4.6
just created a PR, in which case use that PR number.

Follow `references/github-post.md`:
- Build a JSON payload with Critical + Important findings as inline comments
  (only for lines present in the diff hunks).
- POST via `gh api repos/<REPO_SLUG>/pulls/<PR_NUMBER>/reviews` with NO
  `event` field (creates PENDING, visible only to you).
- Verify post-condition: fetch review list, confirm PENDING state exists.
- Print count + link.
- Observation and Idiomatic findings go in the review body, never inline.
- Never submit the review programmatically.
- When fix mode applied and committed a finding, EXCLUDE it from the inline
  comments - do not ask for a change you already made. Mention the applied
  fixes in one line of the review body instead.

### Housekeeping (skip when depth=scan, optional)

If you maintain a persistent notes/memory system across reviews, launch ONE
background Agent with `model: 'haiku'`, passing the review file path +
repo-short-name + PR author login, instructed to follow
`references/post-review.md` if you've written one for your own setup:
- Log durable patterns (recurring findings, confirmed false positives) scoped
  to the repo, never to the author.
- Skip entirely if you have no such system: nothing else in this skill
  depends on it.

### Cleanup (when a worktree was created)

**Fix-mode override:** if fix mode produced commits that were NOT pushed (pr
mode) or NOT landed onto the local branch (branch mode), do NOT clean up. Keep
the worktree and the repo clone, print the worktree path and the exact
push/land command. Deleting it destroys the only copy of the work. Clean up
normally when the push or the land succeeded, or nothing was committed.

In branch mode `repoRoot` is the user's own working copy, never a
`/tmp/lekker-clone-*`. Remove the worktree; NEVER remove `repoRoot`.

```bash
git -C <repoRoot> worktree remove --force <worktreePath> \
  || rm -rf <worktreePath>
git -C <repoRoot> worktree prune
```

If `repoRoot` starts with `/tmp/lekker-clone-`, also remove that clone dir.
Remove the delta file if `deltaFile` was set in worktree.json. Verify with
`git -C <repoRoot> worktree list` that no `lekker-review` entries remain.

---

## Failure rules

Two identical failures = stop and diagnose, don't loop blindly.

If the Workflow tool is unavailable or the run dies: first re-check that
DIFF_FILE, CONTEXT_FILE and WORKTREE_PATH still exist. A killed run often means
the session was torn down, and a teardown takes the worktree and scratchpad with
it - agents launched against vanished inputs return nothing and the tokens are
wasted. Re-run Step 1 before Step 2 if any input is missing.

Once the inputs are confirmed present, fall back to launching the 5 agents via
the Agent tool with the same prompt files,
do verification inline per `references/agents/verifier.md`, and state this
fallback in the review output under a
`**Note:** Workflow tool unavailable - ran agents directly` line in the header.

Fix-mode specific:
- Never claim a fix landed without a `git log` / `git status` receipt from the
  worktree. The review's proposed `fix` text is not an applied fix.
- Never push without explicit confirmation, and never force-push or rebase a
  PR branch. If the branch moved under you, stop and report - the commits stay
  local.
- Branch mode never pushes on its own: landing means moving the reviewed
  commits onto `refs/heads/<LOCAL_BRANCH>` in the user's own `repoRoot`, always
  with a compare-and-swap (`update-ref <new> <old>` or `merge --ff-only`) that
  can only succeed if the branch is still exactly where the review started. If
  it moved, or the working tree is dirty, stop and print the exact command -
  never stash or discard uncommitted work to force the landing through.
