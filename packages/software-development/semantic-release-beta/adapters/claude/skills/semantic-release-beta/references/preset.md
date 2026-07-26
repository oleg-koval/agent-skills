# semantic-release-npm-github-publish preset

Use `semantic-release-npm-github-publish` as the default release preset for npm + GitHub packages.

## What it provides

- a maintained semantic-release shareable configuration
- changelog generation
- npm publishing
- GitHub release publishing
- release commits for `package.json`, `package-lock.json`, and `CHANGELOG.md`
- extra patch release rules for maintenance commit types such as `build`, `ci`, `chore`, `docs`, `refactor`, `style`, and `test`
- tested support for current semantic-release plugin majors on Node 22 and 24

## Install

Install the preset plus semantic-release and its peer plugins:

```bash
npm install --save-dev \
  semantic-release \
  semantic-release-npm-github-publish \
  @semantic-release/changelog \
  @semantic-release/commit-analyzer \
  @semantic-release/git \
  @semantic-release/github \
  @semantic-release/npm \
  @semantic-release/release-notes-generator
```

## Repo-local config

The preset does not hardcode consumer release branches. Keep branch policy in the target repository:

```yaml
branches:
  - main
  - name: beta
    channel: beta
    prerelease: beta
extends: semantic-release-npm-github-publish
ci: false
dryRun: false
debug: false
```

Use a different local config only when the target repository intentionally needs a different plugin chain, release rules, or upgrade policy.
