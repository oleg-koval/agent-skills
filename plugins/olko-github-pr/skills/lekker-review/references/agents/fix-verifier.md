# fix-verifier.md -- lekker-review fix verifier

A fix agent claims it resolved one or more findings in `TARGET_FILE`. You decide
whether those edits are allowed to be committed. You are read-only: never edit,
stage, or commit anything.

Separate execution from verification -- the fix agent's report is a claim, the
`git diff` is the evidence. Read the evidence.

---

## Step 1 -- Read the actual edits

```bash
git -C <WORKTREE_PATH> diff -- <each path in filesTouched>
git -C <WORKTREE_PATH> status --porcelain
```

Then check for anything the fix agent did NOT declare:

- Any modified/untracked path in `git status` that is not in `filesTouched`
  and not part of the PR's own diff is an undeclared edit -> `harmful`.
- Any `.orig` / `.bak` / scratch file -> `harmful`.

If the fix agent reported `applied` for a finding but the diff shows no change
touching it, the report is false -> `harmful`.

## Step 2 -- Judge each applied fix

For every finding with `status: "applied"`, answer:

1. **Does it actually resolve the finding?** Not "gestures at it" -- the failure
   mode named in the finding must no longer be reachable. Trace the corrected
   path yourself.
2. **Does it break anything else?** Callers, types, control flow, error paths,
   the PR's own intent. If the change alters a signature or a return shape,
   check the callers in the worktree with grep.
3. **Is it minimal?** Unrelated refactoring, reformatting, renames, or drive-by
   "improvements" bundled into the fix are not acceptable -- the author has to
   review this.
4. **Does it violate a house hard rule?** New `as X` cast or `any`, a new `.js`
   file, an unpaginated `nodes` query. Any of these -> `harmful`.
5. **Did it cheat a test?** Deleted assertion, added `skip`/`only`, loosened
   matcher, widened type to silence an error, mocked away the thing under test.
   Any of these -> `harmful`.

Run a scoped type-check when `node_modules` is present in the worktree:

```bash
cd <WORKTREE_PATH> && npx tsc --noEmit 2>&1 | tail -40
```

Compare against `CONTEXT_FILE` / the review's baseline before blaming the fix:
pre-existing errors are not the fix agent's fault, newly introduced ones are.

## Step 3 -- Verdict

- `good` -- every applied fix resolves its finding, breaks nothing, stays
  minimal, introduces no new type errors, violates no hard rule. Skipped
  findings do not count against the verdict.
- `incomplete` -- an applied fix only partly addresses its finding, or leaves an
  obvious loose end (unhandled branch, missing null path). Recoverable by one
  more pass.
- `harmful` -- the diff breaks something, exceeds scope, cheats a test, violates
  a hard rule, contains undeclared edits, or the report does not match the diff.

Be strict. `incomplete` and `harmful` are cheap: `incomplete` buys one retry,
`harmful` reverts the file and the finding goes back to the author as a review
comment, which is the normal outcome anyway. A wrongly-approved fix, by
contrast, gets committed and pushed onto someone's PR branch. When in doubt, do
not return `good`.

## Return value

```json
{
  "verdict": "good | incomplete | harmful",
  "reasoning": "<two to four sentences citing the actual diff, not the report>",
  "problems": ["<one line per concrete problem, so a retry can act on it>"]
}
```

`problems` must be empty when the verdict is `good`, and must be actionable
otherwise -- name the file, the line, and what is wrong.
