---
name: coderabbitloop
description: >
  Iteratively drives a GitHub PR to zero unresolved CodeRabbit (coderabbitai[bot]) findings. Reads
  each inline comment's own "Prompt for AI Agents" block (CodeRabbit's ready-made fix spec per
  issue), applies the fix, replies to the thread explaining what was done, resolves it, pushes, and
  re-triggers CodeRabbit. Repeats until clean or a real blocker needs a human. Use when the user
  wants a PR fully addressed against CodeRabbit's review, or says "run coderabbitloop" / "satisfy
  CodeRabbit" / "resolve CodeRabbit comments".
compatibility: Requires git and gh (GitHub CLI) authenticated, with the CodeRabbit GitHub App installed on the repo.
metadata:
  version: "1.2"
allowed-tools: Bash(gh:*) Bash(git:*)
---

# Coderabbitloop

Fix every actionable CodeRabbit finding on a PR, answer each thread, resolve it, and keep going until CodeRabbit has nothing left to say (or a finding needs a human call).

## Inputs

- **PR number** (optional): detect from the current branch if not given.

## How CodeRabbit actually posts (verified against docs.coderabbit.ai and a live install: don't assume otherwise)

CodeRabbit runs as `coderabbitai[bot]` and posts **two independent things**, not one:

1. An auto-generated **walkthrough/summary issue comment**: body starts with the HTML marker `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->`. This is a description, not a review: use it for context only, never as a source of fixable findings.
2. A **formal PR review** carrying one **inline review comment per finding**, each a real, resolvable GitHub review thread at the finding's file/line. Each one contains a `<details><summary>🤖 Prompt for AI Agents</summary>` block: a ready-made fix spec, CodeRabbit's own words, meant to be handed straight to an agent.

**Use the inline threads as the source of truth**, exactly like Greptile/Qodo: fetch via GraphQL `reviewThreads`, which carries native `isResolved` state (see `references/graphql-queries.md`, shared with `qodoloop`; only the bot login and the prompt-heading text differ).

CodeRabbit has slash commands (official, `docs.coderabbit.ai/reference/review-commands`), the ones this loop actually uses:
- `@coderabbitai review`: incremental review of new changes (use this to re-trigger after a push, if automatic review-on-push is off for this repo).
- `@coderabbitai resolve`: marks **all** CodeRabbit threads resolved in one shot. This is a bulk escape hatch, not the default path: this loop resolves threads one at a time, right after replying to each, so the reply-then-resolve record stays intact per finding.
- CodeRabbit also has its own built-in `@coderabbitai autofix`, which commits fixes directly without a model in the loop. Mention it to the user as an alternative if they'd rather skip the loop entirely, but this skill's whole point is the Claude-orchestrated version: don't default to autofix instead of doing the work.

**Rate limit is a real terminal state, not a bug.** A comment reading "you've reached your PR review limit" (confirmed live wording) means CodeRabbit will not review again this cycle: stop and report it, don't loop waiting for something that isn't coming.

## Review state comes from the PR, not from memory

`scripts/pr-review-state.sh` reads the PR and prints one JSON object: the current head, whether
CodeRabbit has acted on that head (a review of it, or any comment after it was pushed), and every
unresolved review thread with its author. Every "is there work / are we done" decision in this
loop comes from its exit code, never from what you remember resolving. The script lives in this
skill's directory, `SKILL_ROOT`: the directory holding this `SKILL.md` (Claude Code prints it as the
skill's base directory when the skill loads; in Codex, derive it from the selected `SKILL.md` path).

| Exit | `verdict`  | Meaning                                                             | Do                                   |
|------|------------|---------------------------------------------------------------------|--------------------------------------|
| 0    | `clean`    | CodeRabbit acted on the current head and no bot thread is unresolved    | exit check: done                     |
| 10   | `findings` | unresolved threads from CodeRabbit **or any other review bot**          | run an iteration                     |
| 20   | `pending`  | CodeRabbit has not acted on the current head yet                        | trigger if needed, then wait         |
| 30   | `limited`  | a rate-limit or paused notice from CodeRabbit after the current head    | stop, report `blocked: rate-limited` |

Resolving the last thread does not make a PR clean: CodeRabbit has not reviewed your push yet. Earlier
versions of this loop exited at exactly that moment, while the next round of comments was still on
its way. Human threads are listed in `.unresolved` (`is_bot: false`) and counted in `.counts.humans`;
they never block `clean`, and this loop never resolves them.

## Instructions

### 1. Identify the PR

```bash
gh pr view --json number,headRefName,headRefOid -q '{number, branch: .headRefName, sha: .headRefOid}'
```

Check out the branch if not already on it, **then require a clean working tree**
(`git status --porcelain` empty) before touching anything:

```bash
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean, refusing to start: would risk committing unrelated changes"; exit 1; }
```

This is the precondition step E's scoped `git add <file>` depends on: staging only the files a fix
touched is safe *because* the tree started clean. Skip it and a file with pre-existing local edits
gets those edits swept into the fix commit right along with it.

### 2. Loop (max 5 iterations)

Keep an explicit iteration counter and stop at 5: the cap is a real bound to enforce, not a figure
of speech. Each pass through A–F is one iteration; on hitting the cap, go straight to the report.

#### A. Read the PR state; wait for CodeRabbit's review of the current head

One read answers both "is there work?" and "has CodeRabbit seen my last push?". `SINCE` is the
timestamp you took right before your last push (step E); leave it empty on iteration 1. Right
after a push, add `--wait 600` straight away: the wait ends only once the bot has acted on the new
head, so threads left open on purpose cannot make the push look reviewed.

```bash
"$SKILL_ROOT/scripts/pr-review-state.sh" --repo OWNER/REPO --pr <PR> --bot coderabbitai --since "$SINCE"
```

- Exit `10` (`findings`): go to B. On iteration 1 this is whatever CodeRabbit (or another bot)
  already posted.
- Exit `20` (`pending`): post `@coderabbitai review` if this repo does not review pushes automatically (`gh pr comment <PR_NUMBER> --body "@coderabbitai review"`). Then wait with the same command plus `--wait 600`. Run the
  wait in the background where the host allows it (Claude Code: Bash `run_in_background`; you are
  re-invoked when it exits) so ten minutes of polling never sits in the conversation. Still `20`
  after the wait: say so out loud, post `@coderabbitai review` once more, and wait once more. Still `20` after that: stop and
  report the timeout honestly; never claim success.
- Exit `0` (`clean`): go to the exit check. A `--wait` call returns `clean` only after a settle
  re-read 60 seconds later, so a comment landing right behind the review is still caught. A bare
  read (no `--wait`) that says `clean` is good enough only when you have not pushed since CodeRabbit's
  last review.
- Exit `30` (`limited`): stop now and report `blocked: rate-limited`; nothing more is coming.
- Exit `1`: the read itself failed (often a transient GitHub 502). Retry once; if it fails again,
  stop and report it. An unknown state is not a clean one.

#### B. Fetch unresolved findings

The working set is every unresolved thread in the state JSON with `is_bot: true`: CodeRabbit's
own (`is_target: true`) **and any other review bot's** (Greptile, for example). A
fix for one bot often draws a comment from another, and leaving those open is how a "finished" loop
leaves a PR that is not clean. Never act on a human's thread (`is_bot: false`); list it in the report.

CodeRabbit's threads are `.unresolved[] | select(.is_target)` in step A's state JSON (the script
already follows pagination). For each, read the full comment
(`gh api repos/{owner}/{repo}/pulls/comments/<comment_id>`) and parse the finding text and the
**Prompt for AI Agents** block (heading text is
`🤖 Prompt for AI Agents`, not `Agent Prompt`: match case/emoji-insensitively).

Threads from other bots come from the state JSON (`.unresolved[] | select(.is_bot and (.is_target | not))`).
They carry no ready-made fix prompt: read the full comment
(`gh api repos/{owner}/{repo}/pulls/comments/<comment_id>`), verify its claim against the real
code, and handle it like any CodeRabbit finding: fix it, or reply with the evidence for not fixing it.

Mark each thread as seen with an 👀 reaction on its first comment (`databaseId` from the query), so
the bot and a watching human can tell it is being worked:

```bash
gh api --method POST repos/{owner}/{repo}/pulls/comments/<DATABASE_ID>/reactions -f content=eyes
```

#### C. Check exit conditions

Stop when step A's read exited `0` (`clean`) after your last push (a `--wait` read, which settles),
or exited `30` (`limited`), or the iteration cap is reached. An empty working set on its own is not
done: with no review of the current head yet, it only means CodeRabbit has not answered your push.

#### D. Fix each finding

For each thread, in order: read the Prompt for AI Agents block in full: it names the issue and the fix. Apply it, staying inside its stated scope. If the suggestion is wrong, unsafe, or needs a product decision, don't force it: note that in step F instead. Track two lists as you go: **fixed** (thread id + the exact files you touched) and **skipped** (thread id + why). Do not resolve anything yet.

#### E. Commit and push FIRST, before resolving anything

Order matters. A resolved thread is a claim that the fix is on the branch, so the push has to succeed
before the claim is made: otherwise a failed commit or push leaves the PR unfixed with the finding
marked resolved, and nobody looks at it again.

If step D changed code:

```bash
# Stage ONLY the files your fixes touched: never `git add -A`, which sweeps up
# unrelated work and untracked secrets sitting in the worktree.
git status --short                     # look before you stage
git add <path> [<path>...]             # the files named in the findings you fixed
git commit -m "address CodeRabbit review feedback (coderabbitloop iteration N)"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)   # step A reads bot activity after this
git push
```

Confirm the push actually landed before continuing:

```bash
git rev-parse HEAD
gh pr view <PR_NUMBER> --json headRefOid -q .headRefOid   # must match
```

If they differ, stop: the fix is not on the PR, so nothing may be resolved yet.

#### F. Reply to each finding, react, then resolve

Only now, with the fixes pushed, reply and resolve. **Reply to the thread first, then react, then
resolve it**, the "answer to the comments" half of the job:

```bash
gh api graphql -f query='
  mutation($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) {
      comment { id }
    }
  }' -f threadId="$THREAD_ID" -f body="$REPLY_TEXT"
```

Pass the thread id and reply text as GraphQL **variables** (`-f threadId=... -f body=...`), never
interpolated into the query string: a reply containing a quote, backtick, or newline breaks (or
injects into) a hand-built query.

Reply body: one or two sentences, what you changed and why, or exactly why you didn't fix it. A
finding you deliberately skip still gets a reply and gets resolved.

Then record the disposition as a reaction on the thread's first comment: the learning signal, and a
visible marker for a human scanning the PR. 👍 (`+1`) for fixed, 👎 (`-1`) for skipped/rebutted.
CodeRabbit reads a 👎 as feedback that the finding was wrong.

```bash
gh api --method POST repos/{owner}/{repo}/pulls/comments/<DATABASE_ID>/reactions -f content=+1
# skipped/rebutted finding:
gh api --method POST repos/{owner}/{repo}/pulls/comments/<DATABASE_ID>/reactions -f content=-1
```

Then resolve (`resolveReviewThread`). Reply first, react, then resolve: a reaction never replaces
the reply, and a resolved thread with no reply loses the reasoning.

Go back to step A.

### Keep the context small; resume instead of restarting

- Carry only three things between iterations: the iteration counter, the latest state JSON, and a
  ledger of each thread you handled (fixed with its commit, rebutted, or blocked). Re-read files
  fresh each iteration; do not re-paste earlier rounds' comment bodies.
- All loop state lives on the PR, so the loop is resumable. If the session has grown long or slow,
  or a bot commented after the loop ended, run this skill again in a fresh session: step A picks up
  from the PR as it is now. Starting fresh is cheaper than dragging a long session through more
  rounds.
- After reporting done, if the host can schedule a follow-up (Claude Code: `/loop` or a scheduled
  wakeup), offer one re-check about 20 minutes later for bots that comment late.

### 3. Report

| Field              | Value |
|--------------------|-------|
| Iterations         | N     |
| Findings resolved  | N     |
| Findings skipped   | N (with reasons) |
| Remaining          | N (if any) |
| Human threads      | N (open, listed; never resolved by this loop) |
| Blocked            | rate-limited / timeout / max-iterations / none |

```
Coderabbitloop complete.
  Iterations:  2
  Resolved:    4 (3 fixed, 1 false-positive, replied + resolved)
  Remaining:   0
```

## References

- `references/graphql-queries.md`: shared with `qodoloop`: the exact `reviewThreads` query (including the `databaseId` the reaction step needs) and the `resolveReviewThread` / `addPullRequestReviewThreadReply` mutations. Filter `author.login` on GraphQL's bare `coderabbitai` (never `coderabbitai[bot]`) and match the prompt heading `Prompt for AI Agents`.
