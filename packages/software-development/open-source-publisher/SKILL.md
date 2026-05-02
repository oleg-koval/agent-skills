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

Use this skill to audit whether an OSS repository is ready to publish, then help only with missing or weak pieces: recognizable icon, shareable social image, GitHub Pages site, standardized README, CI/CD hygiene, release readiness, and optional donation links.

## Workflow

1. Inspect the repository before editing:
   - package/tooling files: `go.mod`, `package.json`, `pyproject.toml`, `Cargo.toml`, `Makefile`, etc.
   - current README, docs, website files, images, workflows, releases, license, funding files
   - existing product purpose, author, install paths, examples, and public URLs
2. Produce a readiness audit before asking for changes:
   - `Ready`: publish-critical pieces that already exist and look usable
   - `Weak`: existing pieces that are present but incomplete, stale, broken, inconsistent, or below the house standard
   - `Missing`: publish-critical pieces that do not exist
   - `Optional`: nice-to-have pieces such as donations or extra badges
3. Classify the repository type before recommending changes:
   - `library`, `CLI`, `web app`, `framework`, `docs site`, or `other`
   - use the type to decide whether governance, packaging, or presentation work should come first
4. Identify maintainer identity and public home information when they affect publishing:
   - Ask for the GitHub handle or org name if the repo will have a public owner/maintainer identity, funding links, release notes, or badges
   - Ask for a canonical website/homepage URL if the project needs a homepage, docs site, or public project URL
   - If `homepage`, `author`, or org metadata already exists and looks current, do not ask again
5. For existing usable pieces, do not propose replacement by default. Ask a change-oriented question only when useful, for example:
   - "You already have a terminal-style GitHub Pages site. Do you want to keep it or restyle it?"
   - "You already have an icon and social card. Do you want a refresh, or should I leave them as-is?"
   - "You already have release automation. Do you want me to audit only, or also tighten it?"
6. Ask only for choices needed to fix missing or weak pieces:
   - If GitHub Pages is missing or weak, ask for style: `oldschool linux`, `terminal`, `modern`, `brutalist`, `glassmorphism`, `y2k`, `hacker`, or custom.
   - If donation wiring is missing, ask whether to enable it: `none`, `GitHub Sponsors`, `Ko-fi`, `Buy Me a Coffee`, `Open Collective`, `Thanks.dev`, or custom URL.
   - If the repo has no clear product essence, ask for a one-sentence positioning statement.
7. Implement only approved, missing, or weak work in this order:
   - OSS governance and support files
   - minimal icon
   - social preview image
   - README standard
   - GitHub Pages landing page
   - CI/CD and release audit/fixes
   - donation wiring, if requested
8. Validate locally and with browser/screenshots when possible.
9. Commit/push only when the user asks or the current task explicitly requires it.

## Readiness Audit

Treat this skill as an OSS publishing readiness checker first and an implementer second. The first response after inspection should be a concise audit with concrete evidence from the repo.

Publish-critical checklist:

- repository identity: clear project name, description, topic/keywords, author, license
- install path: package manager, release assets, source build, or direct download instructions
- maintainer identity: GitHub handle or org name when public identity is relevant
- public home: canonical website/homepage URL when the project needs one
- if either field does not exist, proceed without it and mark it as absent
- OSS governance: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, support policy, issue/PR templates, changelog or release notes path
- README standard: centered shields, icon, title, short description, horizontal rule, essential sections
- icon: simple SVG mark plus rendered PNG, both committed in predictable paths
- social image: 1200x630 image with matching metadata, with both SVG source and rendered PNG committed when practical
- GitHub Pages or docs site: essential install/examples/links/SEO/Open Graph metadata
- CI quality gates: formatter, linter/static analysis, tests, build/package check
- release automation: tags/releases/artifacts/package update flow, docs-only changes excluded where needed
- security posture: license, security notes or policy, OpenSSF Scorecard or equivalent when appropriate
- contribution path: issues/PR guidance, support expectations, project status
- donations: explicitly absent, declined, or configured

Audit output format:

```md
## OSS Publish Readiness

Ready
- README uses the house top block with test, Go Report Card, and OpenSSF shields.
- Release workflow builds darwin arm64/amd64 binaries and updates the Homebrew tap.

Weak
- Direct download examples point at a fixed release tag; latest-release URLs would age better.

Missing
- No `.github/FUNDING.yml`; donations are not configured.

Questions
- You already have a terminal-style GitHub Pages site. Keep it, or restyle it?
- What is the GitHub handle or org name for public attribution?
- What is the canonical website or homepage URL, if any?
- Donations are not configured. Enable them or leave them off?
```

Rules:

- Do not ask for style, donations, or redesign choices before the audit.
- Do not overwrite existing icon, social image, README, site, workflows, or funding files unless the user approves a change or the audit classifies the item as weak.
- If everything publish-critical is ready, say so and offer only optional improvements.
- If the user asks to "run the skill" without more detail, audit first, then wait for approval before making non-trivial visual or workflow changes.
- Keep the audit evidence-based. Reference filenames, workflow names, package metadata, or command outputs.

## Minimal Icon

Create a simple, recognizable SVG logo from the repository's essence. Prefer `logo.svg` and also render `logo.png` so the icon can be reused in README assets, release artifacts, and platform-specific previews.

Icon rules:

- Use one clear metaphor from the project domain, not a collage.
- Keep the mark readable at 32px.
- Prefer 1-2 shapes and 1-2 accent colors.
- Use a simple rounded tile only when it improves favicon readability.
- Avoid terminal window chrome, decorative dots, random badges, and center glyph clutter unless the project itself is a terminal/window tool.
- Avoid generic AI tells: glass effects, bokeh/orbs, over-layered gradients, busy shadows, and unrelated emojis.
- If the repo has a website or homepage, ensure the icon fits that visual system.

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
- keep both files in the repo when practical so the preview can be updated without redrawing the whole asset

Social image rules:

- Include project name, one clear value proposition, and 2-3 concrete capabilities.
- Keep the composition simple and calm. Large readable type beats dense feature lists.
- Use actual project language: commands, package name, supported platform, or primary workflow.
- Match the icon color system.
- Keep all text inside a safe margin of at least 64px.
- Use `og:image`, `twitter:image`, width/height meta tags, and meaningful alt text.
- If the repo has a homepage or canonical website, make the social card and metadata point to that URL consistently.

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

## OSS Governance

Treat governance files as first-class publishing work, not optional paperwork.

Check for, or add when appropriate:

- `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `SUPPORT.md`
- `.github/ISSUE_TEMPLATE/*`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `CHANGELOG.md` or a release notes workflow
- package metadata for homepage, repository, bugs, and funding links

Rules:

- For libraries and CLIs, prioritize governance and release path before visual polish.
- For web apps or product sites, keep the governance checks but allow branding and landing page work to happen earlier when the public-facing experience is the main product.
- If a repo already has governance docs that are good enough, mark them `Ready` and move on.
- If the project has no maintainer/support policy, ask whether support should be community-only, maintainer-only, or commercial.

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
- dependency review / lockfile integrity checks
- secret scanning or secret prevention
- license scanning / OSS compliance scan
- SBOM or provenance generation where appropriate
- security scan or OpenSSF Scorecard where appropriate
- release automation
- docs/site-only path filters when release runs on `main`
- docs link checker or markdown validation for repo/docs sites
- package-specific smoke install / publish dry-run matrix

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
- Prefer signed or attestable releases where the ecosystem supports it.
- Prefer release notes generation from tags or merged PRs instead of hand-written release bodies when the repo is release-heavy.

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
