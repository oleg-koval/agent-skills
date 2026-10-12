#!/usr/bin/env bash
# pr-review-state.sh: read a PR's review-bot state once (or until it settles) and print it as JSON.
#
# Shared by every review loop in olko-github-pr (codexloop, geminiloop, copilotloop,
# coderabbitloop, qodoloop). Each skill ships its own copy so it works on every adapter;
# tests/test-pr-review-state.sh fails if the copies drift apart.
#
# The loops decide "done" from this output, never from their own memory of what they resolved:
#   clean     every --bot has acted on the current head AND no bot thread is unresolved
#   findings  at least one unresolved thread from any bot (target or not): work to do
#   pending   some --bot has not acted on the current head yet
#
# "Acted on the head" = a review of the head commit, or after the head was pushed: a
# comment that is not a progress notice, or a PR reaction other than 👀 (Codex signals a clean
# review with only a 👍 on the PR, and edits a "**Running**" summary comment while it works).
#   limited   a --bot posted a rate-limit / paused notice after the current head
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: pr-review-state.sh --repo OWNER/REPO --pr N --bot REGEX [--bot REGEX ...]
                          [--since ISO8601] [--wait SECONDS] [--settle SECONDS] [--interval SECONDS]

  --bot       case-insensitive regex matched against the bare bot login (GraphQL drops "[bot]"),
              e.g. codex, gemini-code-assist, copilot, coderabbitai, qodo-code-review. Repeatable:
              every --bot must have acted on the current head before the verdict can be "clean".
  --since     when the current head was pushed (date -u +%Y-%m-%dT%H:%M:%SZ, taken before the push).
              Bot activity counts for the head only if it happened after max(head commit date, since).
  --wait      poll until every --bot has acted on the current head (or posted a limit notice), or
              SECONDS pass (default 0: read once). Open threads do not end the wait early, so threads
              left open on purpose cannot make a fresh push look reviewed.
  --settle    once "clean", wait SECONDS and read again, so a late comment is not missed
              (default 60 when --wait is set, else 0).
  --interval  seconds between polls (default 20).

exit: 0 clean, 10 findings, 20 pending, 30 limited, 2 usage, 1 error
EOF
  exit 2
}

REPO="" PR="" SINCE="" WAIT=0 SETTLE="" INTERVAL=20
BOTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --pr) PR="${2:-}"; shift 2 ;;
    --bot) BOTS+=("${2:-}"); shift 2 ;;
    --since) SINCE="${2:-}"; shift 2 ;;
    --wait) WAIT="${2:-}"; shift 2 ;;
    --settle) SETTLE="${2:-}"; shift 2 ;;
    --interval) INTERVAL="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done
[ -n "$REPO" ] && [ -n "$PR" ] && [ "${#BOTS[@]}" -gt 0 ] || usage
case "$REPO" in */*) ;; *) usage ;; esac
[ -n "$SETTLE" ] || { [ "$WAIT" -gt 0 ] && SETTLE=60 || SETTLE=0; }
OWNER="${REPO%%/*}" NAME="${REPO#*/}"
BOTS_JSON=$(printf '%s\n' "${BOTS[@]}" | jq -R . | jq -s .)

QUERY='query($owner:String!,$name:String!,$pr:Int!,$cursor:String){
  repository(owner:$owner,name:$name){ pullRequest(number:$pr){
    headRefOid
    commits(last:1){ nodes{ commit{ oid committedDate } } }
    reviews(last:100){ nodes{ author{ login __typename } commit{ oid } submittedAt body } }
    comments(last:100){ nodes{ author{ login __typename } createdAt updatedAt body } }
    reactions(last:50){ nodes{ content createdAt user{ login } } }
    reviewThreads(first:100, after:$cursor){
      pageInfo{ hasNextPage endCursor }
      nodes{ id isResolved isOutdated path line
        comments(first:1){ nodes{ databaseId url author{ login __typename } body } } }
    }
  } }
}'

# One full read: first page carries head/reviews/comments; every page carries threads.
read_state() {
  local cursor=null page first="" threads="[]"
  while :; do
    page=$(gh api graphql -f query="$QUERY" -f owner="$OWNER" -f name="$NAME" \
      -F pr="$PR" -F cursor="$cursor")
    [ -n "$first" ] || first="$page"
    threads=$(jq -c --argjson acc "$threads" \
      '$acc + .data.repository.pullRequest.reviewThreads.nodes' <<<"$page")
    [ "$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<<"$page")" = "true" ] || break
    cursor=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<<"$page")
  done

  jq -c --argjson bots "$BOTS_JSON" --argjson threads "$threads" --arg since "$SINCE" '
    .data.repository.pullRequest as $p
    | $p.headRefOid as $head
    | ([$p.commits.nodes[0].commit.committedDate // "", $since] | max) as $after
    | def matches($login): any($bots[]; . as $re | ($login // "") | test($re; "i"));
      def isbot($a): ($a.__typename // "User") != "User";
      def progress: test("busy working|in progress|currently processing|currently reviewing|\\*\\*(running|queued)\\*\\*"; "i");
      def limited: test("review limit reached|reached your (pr )?review limit|reviews are paused|rate limit (exceeded|reached)|been rate[- ]limited"; "i");
    [ $bots[] as $re
      | ($p.reviews.nodes  | map(select((.author.login // "") | test($re; "i")))) as $revs
      | ($p.comments.nodes | map(select((.author.login // "") | test($re; "i")))) as $coms
      | ($coms | map(select(.updatedAt >= $after))) as $fresh
      | ($p.reactions.nodes | map(select(((.user.login // "") | test($re; "i"))
                                         and .content != "EYES" and .createdAt >= $after))) as $reacts
      | {
          bot: $re,
          reviewed_head: any($revs[]; .commit.oid == $head),
          activity_after_head: (any($fresh[]; (.body | progress) | not)
                                or ($reacts | length) > 0),
          limited: any($fresh[]; .body | limited)
        }
      | .acted_on_head = (.reviewed_head or .activity_after_head)
    ] as $per_bot
    | [ $threads[] | select(.isResolved | not)
        | .comments.nodes[0] as $c
        | {
            thread_id: .id, comment_id: $c.databaseId, url: $c.url,
            author: $c.author.login, is_bot: isbot($c.author), is_target: matches($c.author.login),
            path, line, outdated: .isOutdated,
            excerpt: (($c.body // "") | gsub("\\s+"; " ") | .[0:160])
          } ] as $open
    | ($open | map(select(.is_bot))) as $open_bot
    | {
        head: $head,
        head_after: $after,
        bots: $per_bot,
        unresolved: $open,
        counts: {
          target: ($open_bot | map(select(.is_target)) | length),
          other_bots: ($open_bot | map(select(.is_target | not)) | length),
          humans: ($open | map(select(.is_bot | not)) | length)
        },
        verdict: (
          if any($per_bot[]; .limited) then "limited"
          elif ($open_bot | length) > 0 then "findings"
          elif any($per_bot[]; .acted_on_head | not) then "pending"
          else "clean" end)
      }' <<<"$first"
}

exit_for() {
  case "$1" in clean) echo 0 ;; findings) echo 10 ;; pending) echo 20 ;; limited) echo 30 ;; *) echo 1 ;; esac
}

deadline=$(( SECONDS + WAIT ))
state=$(read_state)
verdict=$(jq -r .verdict <<<"$state")
waiting() { jq -e '.verdict != "limited" and any(.bots[]; .acted_on_head | not)' >/dev/null <<<"$state"; }
while :; do
  if waiting && [ "$SECONDS" -lt "$deadline" ]; then
    sleep "$INTERVAL"
  elif [ "$verdict" = "clean" ] && [ "$SETTLE" -gt 0 ]; then
    # Clean once is not clean: bots post a review, then a second bot or a follow-up lands.
    sleep "$SETTLE"
    SETTLE=0
  else
    break
  fi
  state=$(read_state)
  verdict=$(jq -r .verdict <<<"$state")
done

printf '%s\n' "$state"
exit "$(exit_for "$verdict")"
