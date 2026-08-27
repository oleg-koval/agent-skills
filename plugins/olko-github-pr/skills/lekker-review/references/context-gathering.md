# Context gathering (Step 1)

## Step 1: Gather Context (run in parallel)

### 1a. PR metadata
```bash
gh pr view <PR_NUMBER> --repo <REPO_SLUG> \
  --json number,title,body,author,headRefName,baseRefName,labels,\
linkedBranches,mergeStateStatus,additions,deletions,changedFiles,isDraft,headRefOid
```

**PR-1 title check (run immediately after 1a, before other steps)**, only if
your `house-rules.md` defines a title/ticket-prefix rule:

```bash
# Collect ticket IDs from the commit log of this PR
gh pr view <PR_NUMBER> --repo <REPO_SLUG> --json commits \
  --jq '[.commits[].messageHeadline | scan("\\[[A-Z]+-[0-9]+\\]")] | unique | join(",")'
```

1. Check that the PR title matches whatever prefix convention `house-rules.md` defines.
2. Extract all ticket references from commit messages and merged PR titles in the commit log.
3. If the PR title is missing the prefix, or is missing any ticket from the commit history:
   - Record `PR_TITLE_ISSUE = true` and `RECOMMENDED_PREFIX = "<all tickets comma-separated>"`
   - This will produce an `⛔ CANNOT MERGE` block at the top of the review output (Step 4), before the Summary.
4. If all tickets are present: `PR_TITLE_ISSUE = false`.

### 1b. Full diff
```bash
gh pr diff <PR_NUMBER> --repo <REPO_SLUG> > "$DIFF_FILE"   # fetched ONCE; all agents read this file
```

### 1c. Issue tracker (optional, skip if you have no ticket-tracker MCP configured)
Search for tickets referenced in the PR title, body, or branch name using
whatever issue-tracker MCP tool (Linear, Jira, GitHub Issues, etc.) is
available in your setup.

Extract: ticket description, acceptance criteria, linked issues, comments.
Collect ACs as a numbered list: this becomes `AC_LIST` used in Step 3.

If no issue-tracker MCP is configured, skip silently: the review still runs
fine on the PR body + diff alone.

### 1d. Team chat *(scan: skip, optional)*
If a chat-search MCP tool (Slack, Discord, etc.) is available, search for the
PR title keywords / branch name / ticket ID to surface design decisions or
trade-offs the team discussed outside the ticket. Skip silently if none is
configured.

### 1e. Docs / wiki *(scan: skip, optional)*
If a docs-search MCP tool (Notion, Confluence, internal wiki, etc.) is
available, search for specs, runbooks, ADRs, or design docs related to this
work. Skip silently if none is configured.

### 1f. Framework/API docs *(scan: skip, optional)*
If the diff touches a specific framework or third-party API and a docs-search
MCP for it is available, verify the implementation matches current API
behaviour and best practices. Skip if not relevant or not configured.

### 1g. Repo placement check: see references/house-rules.md
Only applicable if your org splits work across sibling repos and you've
filled in the repo-taxonomy table in `house-rules.md`.

### 1h. Prior review pattern recall *(scan: skip, optional)*
If you maintain a persistent memory/notes system across review sessions (a
wiki page, a memory MCP, or even a running Markdown file of "patterns we keep
seeing in this repo"), pull relevant entries here: known conventions not yet
in the repo's own CLAUDE.md/README, confirmed false positives from past
reviews, and recurring bug classes to watch for. Skip entirely if you don't
have such a system: this step adds value but nothing depends on it.

Do NOT recall or store author-specific patterns ("author X tends to..."):
scope any such memory to the repo, not the person, so the review stays about
the code, not the author.

### 1i. Production error monitoring *(scan: skip, optional)*
If an error-monitoring MCP (Sentry, Rollbar, Bugsnag, etc.) is available,
search for production errors in the code paths touched by this PR:

```
query: "<repo-short-name> <key module or filename from diff>"
query: "<key function/export names introduced or modified in the diff>"
```

Collect into `MONITORING_SIGNALS`. For each match, note:
- Issue title and link
- Event count and affected users in a recent window
- First seen / last seen: chronic vs. newly introduced
- Whether the culprit or stack trace references a file in the diff

If `MONITORING_SIGNALS` is non-empty, include a `## 🔥 Production Signals`
section in the review output (place it immediately after the Summary, before
findings). Format each entry as:
```
- [<title>](<url>), <N> events / <M> users (recent window) · first seen <date>
  Files: <relevant files from stack trace>
  Note: <one sentence: does this PR fix, worsen, or not affect this error?>
```

If an error traces directly to a function this PR modifies and the PR does
not fix it, escalate: add a finding under `## ⚠️ Important` noting the
pre-existing production error in modified code.

If no monitoring MCP is configured or no matches found, skip the section
silently. Never write "monitoring unavailable" into a review off the back of
a single failed call; either produce the signals or state the actual reason
(auth, no project, genuinely zero matches).

An error in the subsystem that corroborates a finding is worth reporting even
when this PR neither causes nor fixes it: say so explicitly ("not caused or
worsened by this PR") and tie it to the finding it supports. Check the
environment tag: a staging-only error is weaker evidence than a production
one, and claiming otherwise overstates the case.

### 1j. CI check results

```bash
gh pr checks <PR_NUMBER> --repo <REPO_SLUG> 2>/dev/null
```

Collect into `CI_STATUS`. Rules:
- Any **failing** TypeScript/build check → treat as a Critical finding: the
  branch doesn't compile. Quote the check name and link in the finding.
- Any **failing** test check → Critical finding: existing tests are broken.
- Any **failing** lint check → Important finding.
- All checks passing → note `✅ CI passing` in the review header line.
- Checks pending → note `⏳ CI pending` in the header.
- `gh pr checks` unavailable or no checks configured → omit the header note.

### 1k. Existing reviewer comments

```bash
gh pr reviews <PR_NUMBER> --repo <REPO_SLUG> --json author,state,body 2>/dev/null
gh api "repos/<REPO_SLUG>/pulls/<PR_NUMBER>/comments" \
  --jq '.[].body' 2>/dev/null | head -80
```

Collect into `EXISTING_REVIEWS`. Purpose:
- **Awareness only**: do NOT anchor your findings on what other reviewers said.
  If you independently reach the same conclusion, that is fine, but earn it
  from the diff, not from their comment.
- **Deduplication**: if an existing review already raised a finding at a
  specific `file:line`, skip that finding in your output and note
  `(already raised by <reviewer>)` internally in your deduplication pass.
- **Design decisions**: if the author replied to a review comment explaining
  an intentional choice, that context informs whether a pattern is a bug or
  a deliberate trade-off.

### 1 post-gather: Draft / state check

After Step 1a completes, check the `isDraft` field in the PR metadata.

If `isDraft: true`, prepend this notice to the final review output (before
the Summary):

> ⚠️ **Draft PR**: this review is on a work-in-progress branch. Some findings
> may reflect intentionally incomplete work.

Also check `mergeStateStatus`:
- `BLOCKED` → note in the review header as `🚫 Merge blocked`
- `BEHIND` → note as `⏰ Branch is behind base`
- `CLEAN` → no note needed
