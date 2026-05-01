---
name: open-source-publisher
description: Prepare an open-source repository for polished public publishing. Use when a user asks to publish, open-source, launch, polish, package, brand, or make a GitHub project presentable with a minimal project icon, social preview image, GitHub Pages landing page, standardized README, essential shields, CI/CD quality gates, release automation checks, and optional donation setup.
license: MIT
compatibility: Codex, Claude Code, Cursor, and other Agent Skills compatible tools. Requires a writable git repository; browser or image rendering tools are useful for visual validation.
metadata:
  author: Oleg Koval
  tags:
    - open-source
    - github
    - readme
    - branding
    - github-pages
    - ci
    - release
    - social-image
---

# open-source-publisher

Use this skill to turn a useful OSS repository into a clean public package: recognizable icon, shareable social image, GitHub Pages site, standardized README, CI/CD hygiene, release readiness, and optional donation links.

## Workflow

1. Inspect the repository before editing:
   - package/tooling files: `go.mod`, `package.json`, `pyproject.toml`, `Cargo.toml`, `Makefile`, etc.
   - current README, docs, website files, images, workflows, releases, license, funding files
   - existing product purpose, author, install paths, examples, and public URLs
2. Ask only the choices that cannot be inferred:
   - GitHub Pages style: `oldschool linux`, `terminal`, `modern`, `brutalist`, `glassmorphism`, `y2k`, `hacker`, or a custom style.
   - Donations: `none`, `GitHub Sponsors`, `Ko-fi`, `Buy Me a Coffee`, `Open Collective`, `Thanks.dev`, or custom URL.
   - If the repo has no clear product essence, ask for a one-sentence positioning statement.
3. Implement in this order:
   - minimal icon
   - social preview image
   - README standard
   - GitHub Pages landing page
   - CI/CD and release audit/fixes
   - donation wiring, if requested
4. Validate locally and with browser/screenshots when possible.
5. Commit/push only when the user asks or the current task explicitly requires it.

## Minimal Icon

Create a simple, recognizable SVG logo from the repository's essence. Prefer `logo.svg`; add `logo.png` only when a platform requires raster output.

Icon rules:

- Use one clear metaphor from the project domain, not a collage.
- Keep the mark readable at 32px.
- Prefer 1-2 shapes and 1-2 accent colors.
- Use a simple rounded tile only when it improves favicon readability.
- Avoid terminal window chrome, decorative dots, random badges, and center glyph clutter unless the project itself is a terminal/window tool.
- Avoid generic AI tells: glass effects, bokeh/orbs, over-layered gradients, busy shadows, and unrelated emojis.

Good icon pattern for sync/migration tools:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">Project logo</title>
  <desc id="desc">Clean sync icon made from two circular arrows.</desc>
  <defs>
    <linearGradient id="topArrow" x1="142" y1="118" x2="392" y2="250" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#22c55e"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <linearGradient id="bottomArrow" x1="370" y1="394" x2="120" y2="262" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#fb7185"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#0d1117"/>
  <rect x="42" y="42" width="428" height="428" rx="96" fill="#111827" stroke="#1f2937" stroke-width="8"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M142 234c13-70 74-122 147-122 52 0 99 27 126 69" stroke="url(#topArrow)" stroke-width="42"/>
    <path d="M389 118l35 67-75 4" stroke="url(#topArrow)" stroke-width="42"/>
    <path d="M370 278c-13 70-74 122-147 122-52 0-99-27-126-69" stroke="url(#bottomArrow)" stroke-width="42"/>
    <path d="M123 394l-35-67 75-4" stroke="url(#bottomArrow)" stroke-width="42"/>
  </g>
</svg>
```

Adapt the geometry and metaphor. Do not reuse the sync arrows for unrelated projects.

## Social Image

Create a 1200x630 social preview image for GitHub, Twitter/X, Slack, and link unfurls.

Recommended files:

- `social-card.svg` as the editable source
- `social-card.png` rendered from the SVG when render tooling is available

Social image rules:

- Include project name, one clear value proposition, and 2-3 concrete capabilities.
- Keep the composition simple and calm. Large readable type beats dense feature lists.
- Use actual project language: commands, package name, supported platform, or primary workflow.
- Match the icon color system.
- Keep all text inside a safe margin of at least 64px.
- Use `og:image`, `twitter:image`, width/height meta tags, and meaningful alt text.

Render checks:

```bash
rsvg-convert -w 1200 -h 630 social-card.svg -o social-card.png
file social-card.png
```

Use `magick` or another renderer when `rsvg-convert` is unavailable.

## README Standard

Shape the README like the house standard used for Go packages such as `slow-query-detector` and `dcli`.

Top block:

```html
<p align="center">
  <a href="..."><img src="..." alt="tests"></a>
  <a href="..."><img src="..." alt="Go Report Card"></a>
  <a href="..."><img src="..." alt="OpenSSF Scorecard"></a>
</p>

<p align="center">
  <img src="./logo.svg" width="120" height="120" alt="project icon">
</p>

<h1 align="center">project-name</h1>

<p align="center">
  Short product description<br>
  <strong>One-line promise</strong>
</p>

---
```

Choose shields from the repo's tech:

- always: test workflow badge if a test workflow exists
- Go: Go Report Card, OpenSSF Scorecard
- Node/npm: npm version, npm downloads, test workflow, OpenSSF Scorecard
- Python: PyPI version, Python versions, test workflow, OpenSSF Scorecard
- coverage: only include if coverage service is configured
- release: only include if releases are automated and meaningful

Recommended README sections:

1. Features
2. Installation
3. Quick Start
4. Configuration
5. Commands Reference or API Reference
6. System Requirements
7. Documentation
8. Use Cases
9. Architecture
10. Project Status
11. Security Notes
12. Contributing
13. License
14. Author
15. centered footer links

Rules:

- Keep badges centered and compact.
- Keep the icon centered below shields.
- Put a horizontal rule after the centered intro.
- Use current release/download URLs; prefer `/releases/latest/download/...` when stable asset names exist.
- Do not claim coverage, license, support, CI, or releases that are not actually present.
- Add or fix `LICENSE` before saying MIT/Apache/etc.

## GitHub Pages

Create a simple essential GitHub Pages site when the project lacks one or the existing one is weak.

Ask the user to choose one style first:

- `oldschool linux`
- `terminal`
- `modern`
- `brutalist`
- `glassmorphism`
- `y2k`
- `hacker`
- custom style

Required page content:

- project name and icon
- one-sentence value proposition
- author link
- install/download instructions
- 2-4 short examples
- feature summary
- links to GitHub, README, releases, issues
- SEO meta description and keywords
- Open Graph and Twitter meta tags
- social image reference
- footer with license and optional donation/badge links

Implementation defaults:

- Use a static `index.html` unless the repo already has a site framework.
- Add `CNAME` only when the user gives a domain.
- Add `.github/workflows/pages.yml` when Pages uses GitHub Actions or no deploy path exists.
- Avoid marketing fluff and oversized hero sections for developer tools. Make the first viewport useful.
- Use system UI fonts for body text and monospace only for commands, labels, or terminal-specific elements.

## CI/CD And Release Audit

Check whether the repository has:

- formatter check
- linter/static analysis
- tests
- build/package check
- security scan or OpenSSF Scorecard where appropriate
- release automation
- docs/site-only path filters when release runs on `main`

For Go projects, prefer:

```yaml
- go test ./... -race
- go vet ./...
- gofmt check
- staticcheck ./...
- go build ./...
```

For Node projects, prefer existing package manager scripts:

```bash
npm ci
npm run lint
npm test
npm run build
```

Release automation rules:

- Inspect existing release flow before changing it.
- Do not create releases for docs/site-only changes.
- Make Homebrew/package formulas update from real release artifacts and checksums.
- Use least-privilege secrets and document required secret names.
- If automation pushes tags, guard against rerun/version reuse.

## Donations

Ask whether the user wants donations enabled.

If yes:

1. Ask for provider and URL/handle if not inferable.
2. Add `.github/FUNDING.yml` for GitHub-supported providers.
3. Add a short README Support section or footer link.
4. Add site footer/link only if the project has a site.
5. Do not invent payment handles.

Provider hints:

```yaml
github: username
ko_fi: handle
custom:
  - https://example.com/support
```

## Validation

Run the checks that match the edits:

- SVG syntax: `xmllint --noout logo.svg social-card.svg`
- Render social image: `rsvg-convert -w 1200 -h 630 social-card.svg -o social-card.png`
- README links and badge URLs where practical: `curl -I`
- Site render: local static server plus browser/screenshot when available
- Repo tests/build/lint
- Workflow YAML parse, for example with Ruby: `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")'`
- `git diff --check`

Before final response, state:

- files changed
- validation commands run
- release/donation caveats
- any secrets the user must configure
