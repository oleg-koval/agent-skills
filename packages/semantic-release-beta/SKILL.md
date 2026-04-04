---
name: semantic-release-beta
description: Set up or update a Node.js release pipeline that uses semantic-release with a stable main channel and a prerelease beta channel on a beta branch, including GitHub Actions validation and npm publishing behavior.
---

# semantic-release-beta

Use this skill when a project needs a reusable beta prerelease workflow with:

- `semantic-release`
- GitHub Actions
- a stable `main` branch
- a prerelease `beta` branch
- npm publishing with `beta` prerelease versions

## Trigger phrases

- add a beta release workflow
- publish prereleases from a `beta` branch
- set up `semantic-release` with `main` and `beta`
- add release validation or dry-run checks in CI

## Workflow

1. Inspect the repository first.
2. Update `package.json` release config so `main` is stable and `beta` is prerelease channel `beta`.
3. Add a `release:dry-run` script if missing.
4. Update GitHub Actions to test both `main` and `beta`, validate npm auth, and run release dry-run before real releases.
5. Preserve existing package manager, Node version policy, and release plugins unless broader changes are requested.

## References

- `references/node-semantic-release.md`
- `references/github-actions.md`
- `references/validation.md`
