---
name: namespace-runner-migration
description: USE THIS SKILL AUTOMATICALLY whenever changing GitHub Actions runner providers or profiles, including moving workflows to or from Namespace. Migrate workflow runner selectors, open the migration PR and a dependent rollback PR, and schedule a calendar reminder for a verified Namespace trial end date.
metadata:
  short-description: Migrate CI workflows to Namespace and prepare rollback
---

# Namespace Runner Migration

Use this skill automatically when a request changes GitHub Actions runner providers, runner profiles, or `runs-on` selectors. Keep the migration limited to runner selection unless the user asks for other CI changes.

## Workflow

1. Read the repository instructions and inspect the live base branch. Preserve unrelated checkout changes by using an isolated worktree when needed.
2. Inventory every workflow file and every job-level `runs-on` declaration. Identify the current provider, conditional routing, profile label, and any security conditions tied to self-hosted execution.
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:3dd0437972d4d9874b43bf74c7c7c50a7a7a760e6f771bc7a193d5f8fbd6ffc6 -->

3. Confirm the requested destination provider and its exact runner selector from the user, repository configuration, or an authoritative provider source. For migrations away from Namespace to GitHub-hosted Ubuntu, confirm `ubuntu-latest` when requested. Only when Namespace is the destination, confirm the exact Namespace profile label: a `namespace-profile-*` label selects a profile. Do not assume the account name is the profile name when evidence is unavailable.
4. Change only the runner selectors needed for the migration. Keep workflow triggers, permissions, job conditions, deployment gates, and step behavior intact. Remove or update comments that become false. Review security guards separately and preserve them unless the user asks to change them.
5. Validate the diff, including a complete search for old runner selectors and a check that every intended workflow job now selects the confirmed destination provider and selector (for example, `ubuntu-latest` when migrating away from Namespace to GitHub-hosted Ubuntu). Check Namespace profile labels and acceptance only when Namespace is the destination. Run available local CI checks when the repository contract requires them, and report checks that cannot be run. Do not claim live runner acceptance until a workflow has actually run on the destination provider.
6. Commit and push a migration branch. Open a PR with a `TL;DR (for humans)` section that states the before/after runner selection and the effect on where jobs execute. Keep the PR focused and report its current checks accurately. Capture the migration PR's actual base branch from its metadata as the integration branch for rollback; do not assume a default branch name.
7. Prepare a paired rollback PR that restores the exact pre-migration runner settings:
   - If the migration PR is already merged, read its actual base branch from the merged PR metadata, branch from that integration branch's current tip, apply the inverse runner diff, and open a normal PR against that integration branch.
   - If it is not merged, create a draft rollback PR against the migration branch so its diff is genuinely a revert. Record the rollback commit and the migration PR's actual base branch. After the migration merges, fetch the updated integration branch and retarget the rollback PR to it. Never open a supposed revert against the integration branch when that would instead introduce the migration.
   - For a squash-merged migration, retargeting alone can leave the rollback diff empty. Rebuild the rollback branch by rebasing only the rollback commit onto the updated integration branch, or cherry-picking only that commit onto a fresh branch from its current tip. Update the existing rollback PR's branch when possible, or open a replacement against the same integration branch. Resolve only relevant conflicts. Verify the resulting PR diff restores the exact original runner settings before marking it ready; an empty diff is not a rollback.
   - If the user asks for a cherry-pick PR, cherry-pick only the rollback commit onto a branch based on the then-current integration branch, resolve only relevant conflicts, and open the PR against that integration branch. Verify the resulting PR diff restores the original runner settings for every rollback path, including already-merged migrations and retargeted PRs.
   - Do not merge either PR unless the user explicitly asks.


<!-- /coderabbit-ai-generated:v1 -->

8. Find the Namespace trial expiration from an authoritative source such as a trial confirmation, billing page, or a user-provided date. If it cannot be verified, ask for the expiration date and continue with the code and PR work. Do not guess or schedule a placeholder.
9. Once verified, create an all-day Google Calendar event on the expiration date in the user's calendar, with a title such as `Namespace trial ends: review CI runners`. Add a short description linking the migration and rollback PRs. Do not add attendees or send invitations. Re-read the event or rely on the creation receipt to confirm the saved date and calendar.
10. Re-read the live PRs, branch SHAs, check rollups, and calendar event after writes. Report the migration PR, rollback PR and dependency, local checks, live checks, verified trial date, and any remaining acceptance step separately.

## Boundaries

- The migration authorizes only the requested runner changes. Creating the paired PRs and the trial-end calendar reminder is part of this skill when requested.
- Never deploy, merge, change Namespace billing, or enable a profile as a side effect of changing workflow files.
- If the profile is unavailable or its runner requirements are incompatible with a workflow, document the blocker rather than silently falling back to another provider.
- Keep PR bodies factual, avoid placeholder ticket references, and omit generated attribution footers.
