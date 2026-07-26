# GraphQL queries reference

Field names verified by introspection against GitHub's live GraphQL schema
(`AddPullRequestReviewThreadReplyInput`) and against a real Qodo install's
comment output — not guessed.

## Fetch unresolved Qodo threads (paginated)

```graphql
query($cursor: String) {
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes { body path line author { login } }
          }
        }
      }
    }
  }
}
```

Filter client-side to `qodo-code-review[bot]` and `isResolved == false` — the
author isn't filterable server-side in this shape:

```bash
gh api graphql -f query='...' --jq \
  '.data.repository.pullRequest.reviewThreads.nodes[]
   | select(.comments.nodes[0].author.login == "qodo-code-review[bot]")
   | select(.isResolved == false)'
```

## Parsing a thread's finding out of `comments.nodes[0].body`

The body is markdown with embedded HTML. Extract:
- **Title + severity**: first line has a badge image; `alt="Remediation recommended"` = actionable, `alt="Informational"` = optional. The finding title/tags follow on the next line (e.g. `3\. pickclaimroaster branch untested <code>📘 Rule violation</code> ...`).
- **Agent Prompt**: the fenced ```` ```...``` ```` block under a `<summary>` reading either `Agent Prompt` or `Agent prompt` (Qodo's casing differs between the inline-comment surface and the rollup issue-comment surface — match case-insensitively). This block is the whole fix spec: issue description, context, fix focus files/lines, and often a suggested fix. Use it verbatim as the task.

If a thread somehow has no Agent Prompt block (seen only on the rollup's
lower-severity "Optional" entries in some cases), fall back to the finding's
plain-text description above the badge.

## Reply to a thread

```bash
gh api graphql -f query='
mutation {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "THREAD_ID"
    body: "REPLY_TEXT"
  }) { comment { id } }
}'
```

`pullRequestReviewThreadId` and `body` are the only required fields
(`pullRequestReviewId` and `clientMutationId` are optional — omit them).

## Resolve a thread (batch)

```graphql
mutation {
  t1: resolveReviewThread(input: {threadId: "ID1"}) { thread { isResolved } }
  t2: resolveReviewThread(input: {threadId: "ID2"}) { thread { isResolved } }
}
```

Reply before resolving, not the reverse — a resolved thread still accepts
replies, but the point is a human reading the thread later sees the answer
without having to un-resolve it first.

## Fetch the rollup issue comment (context only, not the source of truth)

Useful for the human-readable summary counts (bugs/rule-violations) in your
final report, or as a fallback if `reviewThreads` ever comes back empty for a
PR that clearly has a completed review. Select the latest by `created_at`,
not `updated_at` — unlike Greptile, Qodo does not edit this comment in place;
each pass posts a new one:

```bash
gh api --paginate "repos/{owner}/{repo}/issues/<PR_NUMBER>/comments?per_page=100" \
  | jq -s 'add
    | map(select(.user.login == "qodo-code-review[bot]"))
    | map(select(.body | startswith("<h3>Code Review by Qodo</h3>")))
    | sort_by(.created_at)
    | last'
```

A rate-limit/paused comment reads `<h3>Qodo is busy working</h3>` while
in-flight, or contains "Qodo reviews are paused" / "review limit" when
terminally blocked — check for that text before assuming a missing review
comment just means "still running".
