# github-post.md -- lekker-review --post flag procedure

Execute this procedure AFTER the review file has been saved to `~/code-reviews/`
and ONLY when the user passed `--post`.

---

## Step 1 -- Build the payload

Construct a JSON payload at `/tmp/lekker-post-$$.json` with the structure:

```json
{
  "body": "<summary section>",
  "comments": [
    {
      "path": "<relative file path>",
      "line": <line number>,
      "side": "RIGHT",
      "body": "<finding title + why + fix in GitHub markdown>"
    }
  ]
}
```

Rules:

- **Do NOT include an `event` field.** Omitting it creates a PENDING review,
  visible only to the requesting user until they submit it. NEVER submit the
  review programmatically.
- Include one comment entry for every Critical and Important finding whose
  `file:line` falls within the diff hunks of this PR (see Step 2 for how to
  determine commentability).
- **Keep every comment body to 2-4 sentences and under ~700 characters**
  (excluding any suggestion block). Inline comments are read one at a time in a
  narrow column; a long one does not get read, so length actively costs you the
  fix. The detail belongs only in the saved review file (`~/code-reviews/*.md`).
  Do NOT reproduce the file's full Critical/Important write-up inline.

- **Open with the ask, in the imperative.** The first clause must be the action
  the author takes ("Return early here", "Extract one shared winner-picker",
  "Raise to 250", "Add a double with `session`"). Evidence comes after, and only
  the evidence that makes the ask credible. Never open with a bolded severity
  label, a restated finding title, or a preamble: the author already knows they
  are reading a review comment.

  ```
  ✗ **Important: two implementations of "largest fulfillment order" with
    different tie-break keys.** This ranks by value → units → id; `x.ts:104`
    ranks by shipped qty → id. Diverging input: one shared line referenced by
    FO-A (qty 1, one $100 item) and FO-B (qty 3, three $10 items). Fallback
    picks FO-A, exact picks FO-B. Because `existingCreatedLines` idempotency is
    keyed per `fulfillmentOrderGid` with no cross-FO check, a transient
    exact-API failure on FO-A (fallback wins, line written) followed by a
    successful retry on FO-B (exact wins, line written) posts the shared charge
    twice. Please extract one `pickSharedChargeWinner(candidates, size, id)`…

  ✓ Please extract one shared winner-picker used by both files, keyed on FO
    value. This ranks value → units → id; `x.ts:104` ranks shipped-qty → id, so
    FO-A (qty 1, one $100 item) vs FO-B (qty 3, three $10 items) gives A here
    and B there. Idempotency is keyed per `fulfillmentOrderGid` with no cross-FO
    check, so a fallback run that writes A's line followed by an exact-path
    retry on B writes the same charge twice.
  ```

- **Cut every clause that does not change what the author does.** In particular:
  no severity prefix (the review body already states the counts), no
  "Why it's wrong:" / "Fix:" headers (that is the saved-file format, not the
  inline format), no verifier reasoning, no restating what the PR does, no
  second worked example once the first lands, and no sentence whose content is
  already visible on the commented line.
- **Use a GitHub suggestion block for the fix whenever it's a direct code change**
  anchored to the commented line(s), a reviewer can apply it with one click:
  ```suggestion
  <replacement line(s), exact drop-in for the line(s) the comment is anchored to>
  ```
  Only use a suggestion block when it exactly replaces the commented line(s):
  never for fixes spanning multiple files or requiring a new function/extraction
  elsewhere. For those, describe the fix in one sentence instead and point to
  the saved review for detail; do not paste a plain fenced code block as a
  substitute for a real suggestion.
- **Every inline comment must be ACTIONABLE**: it must ask for a concrete change
  (fix X, add a test for Y, regenerate Z). Do NOT post informational-only or
  FYI comments ("behaviour change, intentional", "note that…", "just flagging").
  If there's nothing to do, there's no comment: put context like that in the
  review body or the saved review file, never as an inline PR comment.
- The review-level `body` field must contain, in this order: the finding counts
  ("0 Critical / 5 Important / 6 Observations / 1 Idiomatic"), one or two
  sentences of risk framing, then **a numbered list of the asks: one line each,
  imperative, matching the inline comments in order**. That list is what the
  author reads first and works from; it must be scannable in ten seconds. Then
  any Production Signals, then a short flat list of Observations marked "no
  action required", then the saved review file path.

  Keep the body itself under ~2,500 characters. If it is longer, the asks are
  buried: cut prose, never cut the numbered asks.
- Do NOT prefix the body with a banner like "## Lekker review". Do NOT praise the
  PR or describe what it does well: no "solid", "handled well", "clean", "nice".
  State the risk and the asks only.
- We use **Linear**, not Jira. Never write "Jira" in any comment or body; refer
  to Linear ticket IDs (e.g. DUBO-201) directly.

---

## Step 2 -- Determine commentability

A line is commentable only if it appears in the diff hunks for the file. To
check, scan `DIFF_FILE` for the relevant hunk headers and added lines:

```bash
grep -n "^@@\|^+" "$DIFF_FILE" | grep -A20 "^.*+.*<relative-file-path>" | head -60
```

If the finding's `line` number does not correspond to a `+` line in the diff
for that file, the finding is NOT commentable -- fold it into the review body
under an "Additional findings" section instead.

Observation and Idiomatic findings go into the body only; never as inline
comments.

---

## Step 3 -- POST the review

```bash
gh api "repos/<REPO_SLUG>/pulls/<PR_NUMBER>/reviews" \
  --method POST \
  --input /tmp/lekker-post-$$.json
```

---

## Step 4 -- Handle 422 errors

If the API returns HTTP 422 (line not in diff):

1. Remove the offending comment object from the payload (identify it from the
   error response body, which names the path and line).
2. Add its content to the review-level `body` under "Additional findings".
3. Retry the POST once with the updated payload.

If the same failure shape occurs a second time: stop, report the error message
to the user, and fall back to "paste manually" -- do not loop further.

---

## Step 5 -- Verify (fresh post-condition)

After a successful POST, immediately fetch the current review list:

```bash
gh api "repos/<REPO_SLUG>/pulls/<PR_NUMBER>/reviews"
```

Confirm:
- A review with `state: "PENDING"` by the current authenticated user exists.
- The `body` field contains the expected summary text.
- The comment count matches what was submitted.

Print the following to the terminal:

```
Posted PENDING review on <PR_URL>
  - <N> inline comments
  - Review ID: <id>

ACTION REQUIRED: Open GitHub in your browser to review and submit the
pending review. Pending reviews are only visible to you until submitted.
```

Clean up the temporary payload file:

```bash
rm -f /tmp/lekker-post-$$.json
```

---

## Step 6 -- Revising an already-posted PENDING review

If the user asks to shorten, reword, or re-scope the comments after posting:

- The review-level `body` alone can be edited in place:
  `gh api repos/<REPO_SLUG>/pulls/<PR_NUMBER>/reviews/<REVIEW_ID> --method PUT --input <json with {"body": ...}>`
  Inline comments survive this untouched.
- **Inline comment bodies cannot be reliably edited on a pending review** --
  `PATCH /pulls/comments/{id}` targets submitted comments. To change them,
  DELETE the pending review and POST a fresh one:
  `gh api repos/<REPO_SLUG>/pulls/<PR_NUMBER>/reviews/<REVIEW_ID> --method DELETE`
  This is safe only because a pending review is visible to nobody else. Capture
  the existing bodies first (`--jq '.body'` and `/reviews/<id>/comments`) so
  nothing is lost if the re-POST fails.
- Verify by re-fetching the pending review and its comment count. Note that
  `line`, `original_line`, and `side` come back `null` for comments on a pending
  review -- that is expected, not a lost anchor. A successful POST (no 422) is
  the receipt that the anchors were accepted.

---

## Notes

- Never add an `event` field to the payload (not even `"COMMENT"`) -- that
  would publish the review immediately to all participants.
- The current authenticated user is whoever `gh auth status` reports.
- If `gh api` is not authenticated, stop and tell the user to run `gh auth login`.
