# GitHub Actions layout

Recommended jobs:

- `test`
- `release-readiness`
- `release`

Core behavior:

- run tests and release-readiness checks on `push` and `pull_request` for `main` and `beta`
- keep `release:dry-run` available on pull requests, without publishing
- run the real release job only on protected pushes to `main` or `beta`, and gate it on a successful `test` job
- use `fetch-depth: 0` for semantic-release jobs
- validate `NPM_TOKEN`
- run `npm run release:dry-run` before the real release
- run the real release with `npm run semantic-release` or the repository's equivalent semantic-release script
- default workflow permissions to `contents: read`; grant only the release job the write permissions its publisher needs
- use a Node version compatible with `semantic-release-npm-github-publish` and its semantic-release peer dependencies
