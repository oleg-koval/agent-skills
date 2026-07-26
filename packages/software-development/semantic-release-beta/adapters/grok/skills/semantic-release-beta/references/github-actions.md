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
- run the real release with `npm run semantic-release` or the repository's equivalent semantic-release script
- use a Node version compatible with `semantic-release-npm-github-publish` and its semantic-release peer dependencies
