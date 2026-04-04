# GitHub Actions layout

Recommended jobs:

- `test`
- `release-readiness`
- `release`

Core behavior:

- run on `push` and `pull_request` for `main` and `beta`
- use `fetch-depth: 0` for semantic-release jobs
- validate `NPM_TOKEN`
- run `npm run release:dry-run` before the real release
