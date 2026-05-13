---
name: obsidian-pr-sync
description: >
  Morning daily sync for Obsidian: fetches open GitHub PRs (review-requested + assigned)
  and today's Google Calendar events, then writes or refreshes "## Schedule" and
  "## PRs to review" sections in today's daily note at
  /Users/oleg.koval/obsidian/cloud-opus/Lead/Daily/YYYY-MM-DD.md.
  Use this skill whenever the user asks to sync PRs to Obsidian, update their daily note
  with GitHub reviews or calendar, check what needs attention today, or run a morning sync.
  Also suitable for scheduled/automated runs — fully idempotent (re-running replaces
  sections, never appends).
compatibility: Requires `gh` CLI authenticated, Google Calendar MCP available, and daily note vault at the path above.
metadata:
  author: Oleg Koval
  tags:
    - github
    - obsidian
    - daily-note
    - pull-requests
    - google-calendar
    - productivity
    - morning-routine
---

# Obsidian Morning Sync

Two sections written to today's daily note: today's calendar and the PR review queue.
Run both every time; they're independent and idempotent.

---

## Part A — Google Calendar

### Step A1 — Fetch today's events

Use the Google Calendar MCP tool to list today's events:

```
mcp__claude_ai_Google_Calendar__list_events
  calendarId: "primary"
  timeMin: TODAY at 00:00:00 local time (ISO 8601)
  timeMax: TODAY at 23:59:59 local time (ISO 8601)
  singleEvents: true
  orderBy: "startTime"
```

If the MCP tool is not available (e.g. running headless without MCP), skip Part A silently and note it in the output.

### Step A2 — Format the section

```markdown
## Schedule

- HH:MM–HH:MM Event title (location or link if present)
- HH:MM–HH:MM Another event
```

Rules:
- All-day events: `- All day  Event title`
- Format times in 24h (`09:00`, `14:30`)
- Include video link (Google Meet / Zoom / Teams URL) if present in event description or location — use the bare URL, no markdown link syntax
- Omit calendar noise: "OOO", declined events, events where attendee status is `declined`
- If no events today: `## Schedule\n\n_No events today_`

**Example:**
```
## Schedule

- 09:00–09:30  Standup (meet.google.com/abc-defg-hij)
- 14:00–15:00  1:1 Frank
- 16:00–16:30  RFC review — postgres-job-resource
```

### Step A3 — Write to note (idempotent)

Replace `## Schedule` section if it exists, otherwise insert it **before** `## PRs to review`
(or before the nav footer `*← [[...` if PRs section not present).

---

## Part B — GitHub PRs

### Step B1 — Fetch PRs

Run two `gh` queries and merge results, deduplicating by URL:

```bash
# Review-requested (someone explicitly asked for your review)
gh search prs --review-requested=@me --state=open \
  --json title,url,repository,author,createdAt,isDraft --limit 50

# Assigned (you're the assignee but may not be review-requested)
gh search prs --assignee=@me --state=open \
  --json title,url,repository,author,createdAt,isDraft --limit 50
```

Track the source for each PR: a PR can appear in both lists. After dedup by URL, mark each as:
- `review` — present in review-requested results
- `assigned` — present in assigned results only

### Step B2 — Filter

Discard entries where:
- `isDraft` is `true`
- `author.login` matches any bot pattern: `dependabot`, `copilot`, `renovate`, `github-actions`, or `author.is_bot` is `true`
- `author.login` is `oleg-koval` — self-authored PRs are not reviews; they belong in a separate "My PRs" workflow

### Step B3 — Enrich authors

For each unique author login, resolve a display name for the Obsidian wiki-link:

```bash
gh api /users/<login> --jq '.name // .login'
```

Fall back to login with first letter uppercased if name is null.
Batch these lookups in parallel to keep the sync fast.

### Step B4 — Calculate age

For each PR: `days_old = (today - createdAt).days`. Use today's date.

### Step B5 — Build the section

```markdown
## PRs to review

### Work (Teifi-Digital)
- [ ] [TITLE](url) by [[Author Name]] (N days old)

### Personal
- [ ] [TITLE](url) by [[Author Name]] (N days old)
```

Rules:
- **Work**: `repository.nameWithOwner` starts with `Teifi-Digital/`
- **Personal**: everything else
- Within each group, sort by `createdAt` ascending (oldest first — most overdue at top)
- Omit empty subsections (no empty `### Work` header if no work PRs)
- Add `⚠️` after age if `days_old >= 7`
- If zero PRs total: `## PRs to review\n\n_No open PRs — clear queue! 🎉_`

**Example line:**
```
- [ ] [RSL-108] Image sync from InRiver by [[Merlijn Mac Gillavry]] (12 days old ⚠️)
```

### Step B6 — Write to note (idempotent)

**Find today's note:**
```bash
TODAY=$(date +%Y-%m-%d)
NOTE="/Users/oleg.koval/obsidian/cloud-opus/Lead/Daily/${TODAY}.md"
```

If the file doesn't exist, create it with the standard daily template first:

```markdown
---
type: daily
date: YYYY-MM-DD
tags: [lead/daily]
---

# WEEKDAY, D MMM YYYY

## Top 3 for today
1. 
2. 
3. 

## People check-in
> Who needs something from me today?



## Notes / journal


## Open loops
> Things I started but didn't finish



## Actions
- [ ] 

---
*← [[Lead/Daily/YESTERDAY|YESTERDAY]]  |  [[Lead/Daily/TOMORROW|TOMORROW]] →*
```

Then append both sections.

**Replacement logic (idempotent) for each section:**
- If the section (`## Schedule` or `## PRs to review`) already exists: replace everything
  from that heading line up to (not including) the next `## ` heading or end-of-file.
- If it doesn't exist: append before `*← [[...` nav footer (or at file end).

---

## Output to user

```
Morning sync complete → Lead/Daily/YYYY-MM-DD.md
  Schedule: N events
  PRs — Work (Teifi-Digital): X  |  Personal: Y  |  Skipped: Z bots/drafts
```

If any tool call fails (gh auth expired, Calendar MCP unavailable), report which part
failed and write what succeeded — never leave a partial corrupt section.
