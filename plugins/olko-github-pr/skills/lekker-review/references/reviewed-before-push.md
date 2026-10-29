# Reviewed before push

`reviewed-before-push` records a completed local branch review of the current
PR head. It is informational: it does not satisfy CI, required remote review,
or the human-review marker for risky changes. The review comment records the
full head/base SHAs, engine, depth, timestamp, and result. It is an attestation
by the publishing user, not cryptographic proof that review preceded a push.

## Install stale-label cleanup once per repository

Copy `references/reviewed-before-push.yml` into the target repository as
`.github/workflows/reviewed-before-push.yml` and land it on the default branch
through that repository's normal review process. Do this before the local
review whose receipt will be published. Do not add a workflow commit after
review and then label that unreviewed commit.

The workflow uses only GitHub API data, with no PR checkout. On new commits or
receipt edits/deletion it removes the label unless a receipt from an owner,
member, or collaborator matches the live head. Pagination includes all receipt
comments. It does not add labels or replace merge gates. A newly reviewed head
can be labeled again by the publisher. Cleanup is asynchronous; the label is
not a merge-authorization signal. Workflows disabled by repository policy or
Actions outages can delay removal.

The helper refuses to publish if the cleanup workflow is absent. If setup is
missing, keep the local review and PR creation successful, omit the label, and
report the missing setup. Never silently install a write-capable workflow in
another repository. A push-only run keeps the receipt locally until a PR exists.

## Record before pushing

Only in `MODE=branch`, after the review engine completed without degraded or
missing required dimensions, settle every Critical/Important finding. Either
fix it with verifier/test evidence or explicitly rebut it with a reason. Open
observations may remain. A file containing only a review path or a SHA marker
is not sufficient evidence.

Save `<scratchpad>/pre-push-review.json` before the push:

```json
{
  "version": 1,
  "mode": "branch",
  "result": "passed",
  "headSha": "<full reviewed final local HEAD>",
  "baseSha": "<full merge-base used by this review>",
  "engine": "codex",
  "depth": "medium",
  "reviewedAt": "<UTC ISO timestamp when this review completed>",
  "findings": [
    {
      "severity": "important",
      "disposition": "fixed",
      "evidence": "<actual fix verification and relevant test result>"
    }
  ]
}
```

Use an empty `findings` array when the review found nothing. Otherwise include
every finding in the merged review and lint set. Allowed dispositions are
`fixed`, `rebutted`, and `open`; `open` is permitted only for observations and
idiomatic suggestions. Rebuttals require specific evidence too. Set engine and
depth to the values actually used. Keep the saved full review locally; finding
text, evidence text, and local paths are not uploaded by the helper.

`reviewedAt` must be a valid UTC ISO timestamp in `YYYY-MM-DDTHH:mm:ssZ`
format, optionally with fractional seconds before `Z` (for example,
`2026-10-29T09:00:00.123Z`). Date-only strings, timezone offsets, and invalid
calendar dates are rejected by the publisher and cleanup workflow.

After fixes, the receipt must describe the final SHA: fix verification and
relevant tests must pass, and the only intervening edits must be those verified
fixes. Any unrelated edit requires a fresh review. Never copy a receipt to a
new SHA just to make the label apply.

## Publish after pushing and creating or locating the PR

Resolve the helper relative to the selected `SKILL.md` (same directory's
`scripts/review-label.mjs`, including in Codex). Invoke with separate process
arguments, or independently shell-quote each value:

```bash
node "<SKILL_ROOT>/scripts/review-label.mjs" \
  --repo "<owner/repo>" --pr "<number>" \
  --receipt "<scratchpad>/pre-push-review.json"
```

The helper checks the live open PR head, posts the receipt, creates the label
if needed, and applies it. It checks the head before and after labeling, and
removes the label if a concurrent push changed the head. Errors are failures
to publish the label, not a failed local review. Do not claim the label was
applied when the helper failed. Do not use this helper for a review performed
in `MODE=pr` after pushing.
