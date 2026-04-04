# Node semantic-release config

Use this pattern when a Node package should publish stable releases from `main` and prereleases from `beta`.

## Core points

- add `release:dry-run` as `semantic-release --dry-run --no-ci`
- configure `release.branches` for `main` and `{ name: "beta", channel: "beta", prerelease: "beta" }`
- keep existing plugins when the repo already uses semantic-release
