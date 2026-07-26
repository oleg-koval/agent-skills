# GraphQL queries reference

Field names verified by introspection against GitHub's live GraphQL schema
(`AddPullRequestReviewThreadReplyInput`) and against a real Qodo install's
comment output — not guessed.

**The bot's login string is spelled differently in REST vs GraphQL.** REST
(`.user.login` on `issues/.../comments`) returns `qodo-code-review[bot]`.
GraphQL (`author.login` on `reviewThreads`) returns `qodo-code-review` — no
`[bot]` suffix — confirmed live against a real PR with real Qodo inline
threads. Using the REST spelling in a GraphQL filter silently matches
nothing, which reads as "no findings" instead of "wrong filter" — exactly the
kind of bug that has no crash and no error to notice. Use `[bot]` only in
REST-based jq filters (`.user.login`); use the bare name everywhere you're
filtering a GraphQL `author.login`.

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

Filter client-side to `qodo-code-review` (GraphQL spelling — see the note
above) and `isResolved == false` — the author isn't filterable server-side in
this shape. **Follow `pageInfo.hasNextPage`/`endCursor` until it's exhausted**;
stopping after the first page silently drops every thread past the 100th on a
PR with a lot of findings:

A page fetch can occasionally come back malformed (a transient API hiccup,
not anything specific to this query — reproduced live, then failed to
reproduce on an identical immediate retry). Retry once per page before
giving up rather than letting the whole loop crash on it:

```bash
CURSOR=null
ALL_THREADS='[]'
while :; do
  for attempt in 1 2; do
    PAGE=$(gh api graphql -f query='
      query($cursor: String) {
        repository(owner: "OWNER", name: "REPO") {
          pullRequest(number: PR_NUMBER) {
            reviewThreads(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                comments(first: 1) { nodes { body path line author { login } } }
              }
            }
          }
        }
      }' -f cursor="$CURSOR")
    jq -e . >/dev/null 2>&1 <<< "$PAGE" && break
    [ "$attempt" = "2" ] && { echo "page fetch failed twice, aborting" >&2; exit 1; }
  done

  ALL_THREADS=$(jq -c --argjson acc "$ALL_THREADS" \
    '$acc + .data.repository.pullRequest.reviewThreads.nodes' <<< "$PAGE")

  HAS_NEXT=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<< "$PAGE")
  [ "$HAS_NEXT" = "true" ] || break
  CURSOR=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<< "$PAGE")
done

echo "$ALL_THREADS" | jq \
  '.[] | select(.comments.nodes[0].author.login == "qodo-code-review") | select(.isResolved == false)'
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
  mutation($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) {
      comment { id }
    }
  }' -f threadId="$THREAD_ID" -f body="$REPLY_TEXT"
```

Pass the thread id and reply text as GraphQL **variables** (`-f`), never
interpolated straight into the query string. A reply containing a quote,
backtick, or embedded newline breaks — or, worse, injects into — a
hand-built query string; `gh api graphql -f` handles the escaping correctly
when the value travels as a variable instead.

`pullRequestReviewThreadId` and `body` are the only required input fields
(`pullRequestReviewId` and `clientMutationId` are optional — omit them).

## Resolve a thread (batch)

```graphql
mutation {
  t1: resolveReviewThread(input: {threadId: "ID1"}) { thread { isResolved } }
  t2: resolveReviewThread(input: {threadId: "ID2"}) { thread { isResolved } }
}
```

Only resolve a thread whose fix is already pushed and confirmed durable on
the branch (SKILL.md §2E-F) — resolving first and pushing second means a
failed push leaves GitHub showing the finding as handled when it isn't. Never
resolve a blocked/skipped finding at all; reply to it and leave it open.

## Fetch the rollup issue comment (context only, not the source of truth)

Useful for the human-readable summary counts (bugs/rule-violations) in your
final report, or as a fallback if `reviewThreads` ever comes back empty for a
PR that clearly has a completed review. Select the latest by `created_at`.
Whether Qodo edits this comment in place across passes or posts a new one
each time is **unconfirmed** — every PR checked had exactly one, untouched
since creation, which doesn't distinguish the two. Sort by `created_at` and
take the last one either way; it's correct under both behaviors:

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
