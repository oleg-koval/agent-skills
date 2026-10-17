---
name: nas-actions-migration
description: Migrate GitHub Actions jobs to a repository-scoped NAS runner safely.
license: MIT
allowed-tools: Bash, Read, Write, Edit
compatibility: Codex, Claude Code, Cursor, GitHub Copilot, Windsurf, Kiro, and other Agent Skills compatible tools. Requires authenticated GitHub CLI, repository access, and NAS runner administration.
metadata:
  targets: [_source-only]
  author: Oleg Koval
  tags:
    - github-actions
    - self-hosted-runner
    - nas
    - ci
    - deployment
    - migration
---

# NAS Actions Migration

Migrate eligible GitHub Actions jobs from hosted runners to a dedicated, repository-scoped NAS runner, following the proven Roazon and Funda Radar pattern. This workflow prepares repository changes and documents runner provisioning; it does not claim migration complete until jobs actually execute on the named NAS runner. Never put deployment credentials on a persistent self-hosted runner unless the user explicitly approves that trust boundary.

## When to Use

Use when asked to move Actions/CI jobs to a NAS, copy the Roazon/Funda Radar runner setup, or establish a repeatable NAS migration for another repository.

## Prerequisites

- Authenticated `gh` with access to the target repo and its Actions settings.
- SSH/admin access to the NAS and an approved secret manager for durable runner credentials.
- Read repository instructions and the target workflows before changing them.
- Inspect existing comparable repos; treat runner names, labels, commands, and service-specific workflow behavior as examples, not copy-ready values.

## Procedure

1. **Inventory the target.** Record every workflow, job, `runs-on`, trigger, fork behavior, required secrets, runtime/dependency setup, timeouts, deploy side effects, and current status. Determine the repository default branch and ensure the checkout is clean. Check existing repository runners and variables:

   ```sh
   gh api repos/OWNER/REPO/actions/runners --jq '.runners[] | {name,status,labels:[.labels[].name]}'
   gh variable list --repo OWNER/REPO
   ```

2. **Inspect a known-good migration.** Compare the requested repository with the live `roazon` and `funda-radar` workflows and runner docs. Use a unique runner label for the target repo: repository-scoped runners cannot be shared across repositories. Never assume a label, runner container, or variable is already present.

3. **Classify jobs.** Move builds/tests/lint and other trusted, non-secret CI work first. Keep deploy jobs on hosted runners by default so deploy credentials never reach the NAS. Move additional jobs only after assessing credential exposure, untrusted code paths, network/data access, persistence, and resource requirements. Preserve existing required checks and non-blocking semantics.

4. **Route through an explicit opt-in variable.** Use a repository variable such as `CI_RUNNER=nas`, with a hosted-runner fallback until activation:

   ```yaml
   runs-on: ${{ vars.CI_RUNNER == 'nas' && fromJSON('["self-hosted","linux","REPO-nas"]') || 'ORIGINAL_HOSTED_RUNNER' }}
   ```

   Replace `ORIGINAL_HOSTED_RUNNER` with the job's exact existing hosted `runs-on` value; do not silently substitute `ubuntu-latest`. Required fork checks must remain non-skipped on the hosted fallback. If a required check cannot safely run on NAS, keep that job hosted or add a separate non-skipped required gate that blocks until the trusted check runs.

   For every job that can execute repository-controlled code on the NAS, never use `github.event_name != 'pull_request'` as a trust predicate: it treats privileged events as trusted merely because they are not `pull_request`. Choose the origin check for the actual trigger:

   - `pull_request`: allow NAS only for a verified trusted origin; keep fork PRs on the hosted fallback.
   - `pull_request_target`: keep the job hosted unless the workflow is base-controlled, never checks out the PR head, and independently verifies a trusted origin.
   - `workflow_run`: verify `github.event.workflow_run.head_repository.full_name`, the triggering workflow, and the trusted ref before allowing NAS execution.
   - `merge_group`: keep NAS off unless the merge-queue source is explicitly verified as trusted; do not infer trust from the event name.
   - `issue_comment`: resolve the referenced PR and verify its origin and the comment actor through the API before running any PR-controlled code; otherwise keep it hosted.

   For a simple `pull_request` workflow whose fork checks must remain enabled on hosted runners, scope the NAS restriction to NAS routing and guard each job independently:

   ```yaml
   if: >-
     vars.CI_RUNNER != 'nas'
     || (
       github.event_name == 'pull_request'
       && github.event.pull_request.head.repo.full_name == github.repository
     )
   ```

   Never rely on a downstream job's guard to protect an unguarded dependency. Same-repository automation PRs still require an explicit trust policy; repository identity alone is not sufficient. Treat dependency-update and other bot-authored PRs as untrusted by default; keep them hosted unless their login, ref, workflow, and required approvals are explicitly allowlisted. Keep NAS routing in a base-controlled workflow or protected runner-group policy that PR changes cannot weaken. A fork-controlled workflow must not be able to select the NAS runner. Add `workflow_dispatch` to a workflow's `on:` triggers if the provisioning/verification instructions dispatch it manually. Add exact toolchain setup because runner images may not contain Node, Bun, browsers, Docker, or compatible system libraries.

5. **Document provisioning and rollback.** Provide the target repo's exact runner name, label, container/image, dedicated work directory, ephemeral/restart settings, required tool installation, safe secret storage, and health check. For persistent `myoung34/github-runner` containers, use a narrowly scoped fine-grained PAT with repository Administration read/write only for the runner registration service. Store it in a root-only secret file that the job execution identity cannot read; do not expose it through the job service environment, shared workspace, process arguments, or inherited workflow variables. Set `UNSET_CONFIG_VARS=true` and verify after registration that `ACCESS_TOKEN` and registration credentials are absent from the job environment and readable files. Keep the runner service and job execution in separate identities or containers with no shared credential access. Rotate the PAT before expiry and monitor registration failures so the runner is disabled or rolled back rather than left routing jobs to a dead NAS. Add a preflight check before running downloaded or repository-controlled tooling to fail if a runner credential reached job steps. Do not print, commit, message, or substitute a short-lived registration token for a restart-persistent credential. Never reuse another repo's `/_work` or token.

   Document rollback as deleting the opt-in variable, which routes eligible jobs back to `ubuntu-latest`. State that this fallback still depends on GitHub Actions billing being available.

6. **Provision before activation.** Confirm the target repository runner is online and has `self-hosted`, `Linux`, and the exact repo label. If there is no approved NAS access/token, stop before registration and leave the variable unset. Never create a fake runner or assume an online runner in another repo is usable.

7. **Activate and exercise the real path.** Set the repository variable only after runner readiness. Dispatch each affected workflow on a trusted branch, then inspect run/job details and confirm every moved job reports the intended `runner_name`, expected runner labels, and passes. A green result on `ubuntu-latest`, a skipped job, or a successful deployment-provider status does not verify NAS execution.

8. **Recheck safety and report.** Review the final diff, validate workflow syntax, run any local lint/tests available, and inspect for unsafe fork access, missing setup, accidental secret exposure, and unintended deploy changes. Report changed workflows, moved and intentionally unmoved jobs, runner readiness, verification run URLs and runner names, rollback command, and blockers. Do not say “migrated” while registration or NAS execution remains unverified.

## Pitfalls

- GitHub repository runners are scoped to their repository unless deliberately configured as organization runners; the Roazon and Funda runners do not automatically serve a third repo.
- `CI_RUNNER=nas` is opt-in routing, not runner provisioning. Setting it before registration leaves jobs queued or failed.
- Self-hosted runners execute untrusted code with the runner host's access. Fork guards are mandatory, and persistent workspaces must be isolated.
- The current runner container may lack a runtime or compatible glibc. Test project-specific integration jobs on the exact image before declaring success.
- A billing-blocked hosted fallback cannot rescue a failed/offline NAS runner.
- Do not migrate deploy credentials or mutate production service settings as incidental cleanup.

## Verification

Migration is complete only when (a) the target runner is online with the expected repo-specific label, (b) every intended job's run metadata names that runner, (c) the required jobs pass on a trusted ref, (d) fork-origin jobs are skipped before reaching NAS, and (e) rollback to hosted routing is documented and can be applied. Otherwise report **prepared, not activated/verified** with the exact missing prerequisite.