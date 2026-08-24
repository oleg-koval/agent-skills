# GraphQL queries reference

Field names verified by introspection against GitHub's live GraphQL schema
(`AddPullRequestReviewThreadReplyInput`, `ResolveReviewThreadInput`) and
against CodeRabbit's own documentation (`docs.coderabbit.ai/reference/review-commands`)
plus a real `<!-- ... summarize by coderabbit.ai -->` comment observed live —
not guessed.

## Fetch unresolved CodeRabbit threads (paginated)

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

Filter client-side to `coderabbitai[bot]` and `isResolved == false`:

```bash
gh api graphql -f query='...' --jq \
  '.data.repository.pullRequest.reviewThreads.nodes[]
   | select(.comments.nodes[0].author.login == "coderabbitai[bot]")
   | select(.isResolved == false)'
```

## Parsing a thread's finding out of `comments.nodes[0].body`

- **Finding text**: the prose above the collapsible sections — CodeRabbit
  states the issue directly, no severity badge system like Qodo's.
- **Prompt for AI Agents**: the fenced ```` ```...``` ```` block under
  `<details><summary>🤖 Prompt for AI Agents</summary>` (match the heading
  text case-insensitively and tolerate the emoji being present or stripped —
  it renders inconsistently across surfaces). This is the fix spec CodeRabbit
  itself wrote; use it verbatim as the task.

If a thread has no Prompt-for-AI-Agents block, fall back to the plain
description text above it — not every low-confidence nit gets one.

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

`pullRequestReviewThreadId` and `body` are the only required fields.

## Resolve a thread (batch)

```graphql
mutation {
  t1: resolveReviewThread(input: {threadId: "ID1"}) { thread { isResolved } }
  t2: resolveReviewThread(input: {threadId: "ID2"}) { thread { isResolved } }
}
```

Reply before resolving, not the reverse — a resolved thread still accepts
replies, but the point is a human reading it later sees the answer without
un-resolving it first.

CodeRabbit also exposes `@coderabbitai resolve` as a plain PR comment, which
marks every one of its threads resolved at once server-side. That's a valid
bulk escape hatch if the user wants to blow through remaining low-value nits,
but it skips the per-finding reply — don't use it as the default path.

## Fetch the walkthrough/summary comment (context only, not the source of truth)

```bash
gh api --paginate "repos/{owner}/{repo}/issues/<PR_NUMBER>/comments?per_page=100" \
  | jq -s 'add
    | map(select(.user.login == "coderabbitai[bot]"))
    | map(select(.body | contains("auto-generated comment: summarize")))
    | sort_by(.created_at)
    | last'
```

A rate-limit comment contains the literal text "review limit" — check for
that before assuming a missing review just means "still running". Whether
CodeRabbit edits this summary comment in place across passes or posts a new
one each time is **unconfirmed** — every PR checked so far had exactly one,
untouched since creation, which doesn't distinguish the two. Sort by
`updated_at` and take the last one either way; it's correct under both
behaviors and costs nothing if it turns out to always post fresh.
