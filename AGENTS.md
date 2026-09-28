# Agent instructions


## Review findings

When asked to review code or a pull request, treat review and implementation as one task by default. Inspect the relevant code and requirements, verify each finding against the codebase, and implement every valid actionable finding directly in the working tree. Add or update focused tests when appropriate, run the relevant verification, and re-read the final diff.

Do not leave a review comment for a finding that you fixed. Leave a comment only when the finding is ambiguous, requires a product or architecture decision, or cannot be safely verified. Do not hand implementation off to another agent when the fix can be completed in the current task.
