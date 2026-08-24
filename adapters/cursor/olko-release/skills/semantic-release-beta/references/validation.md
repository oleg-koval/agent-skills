# Validation

Prefer these checks:

```bash
npm test
npm run build
npm run release:dry-run
```

Common failure points:

- missing `fetch-depth: 0`
- invalid or missing `NPM_TOKEN`
- missing `beta` branch config
- missing `semantic-release-npm-github-publish` or one of its peer plugins
- plugin config drifting from actual repo files
