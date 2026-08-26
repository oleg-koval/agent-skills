# Versioning

This repository versions the installable catalog release, not each individual
skill. A skill is a canonical `SKILL.md` plus its resources; it is not an
independently published package. The catalog is split into installable plugins,
and every plugin in a release shares the catalog version.

The version source is `package.json`. Conventional commits on `main` and
`beta` are evaluated by semantic-release, which updates the package version,
changelog, Git tag, GitHub release, and npm publication. The generated Claude
plugin manifests receive that same version during semantic-release's `prepare`
phase from semantic-release's explicit `nextRelease.version`, before the
release commit is created. This avoids depending on the order in which release
plugins update `package.json`.

Do not add a version to an individual skill unless that skill becomes an
independently distributed package with its own compatibility and release
lifecycle.

To verify the generated state locally:

```bash
npm run build
git diff --exit-code
npm test
```
