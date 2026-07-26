# Node semantic-release config

Use this pattern when a Node package should publish stable releases from `main` and prereleases from `beta`.

Prefer the `semantic-release-npm-github-publish` shareable config for the plugin chain. Keep branch policy in repo-local config because the preset is intentionally branch-agnostic for consumers.

## Core points

- add `release:dry-run` as `semantic-release --dry-run --no-ci`
- add `semantic-release` as `semantic-release` if the repository does not already have a release script
- configure branches for `main` and `{ name: "beta", channel: "beta", prerelease: "beta" }`
- extend `semantic-release-npm-github-publish` unless the project requires a different plugin composition
- preserve existing custom plugins only when they represent intentional behavior not covered by the preset
