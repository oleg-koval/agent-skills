#!/usr/bin/env node
/*
 * Static site generator for the agent-skills catalog.
 *
 * Reads the machine-readable catalog (the same file `npm test` validates) and
 * emits a dependency-free static site into `_site/` for GitHub Pages.
 * There is no templating library on purpose: the catalog is small, the output
 * must stay auditable, and CI should not need a lockfile refresh to publish.
 */

import { mkdir, readFile, readdir, copyFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../scripts/lib/catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "_site");

const SITE_URL = "https://skills.olegkoval.com";
const REPO = "https://github.com/oleg-koval/agent-skills";
const CNAME = "skills.olegkoval.com";

/* ------------------------------------------------------------- utilities */

const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const titleCase = (slug) =>
  slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Pulls the YAML-ish frontmatter block off a SKILL.md without a YAML dep. */
const readFrontmatter = async (path) => {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    fields[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return fields;
};

/** Counts the extra reference material shipped alongside a skill. */
const countSupportFiles = async (dir) => {
  let files = 0;
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "adapters") continue; // wrappers, not content
      if (entry.isDirectory()) await walk(join(current, entry.name));
      else if (entry.name !== "SKILL.md") files += 1;
    }
  };
  if (existsSync(dir)) await walk(dir);
  return files;
};

/* ----------------------------------------------------------------- chrome */

const layout = ({ title, description, canonical, body, ogTitle }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="agent skills">
<meta property="og:title" content="${esc(ogTitle || title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#c3ac84">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/paperbag.css">
</head>
<body>
<div class="grain" aria-hidden="true"></div>
<div class="halftone" aria-hidden="true"></div>
<div class="blotch" aria-hidden="true"></div>
<div class="smudge" aria-hidden="true"></div>
<div class="shell">
<header class="masthead">
  <a class="wordmark" href="/">agent&nbsp;skills</a>
  <nav aria-label="Primary">
    <a href="/#catalog">Catalog</a>
    <a href="/#install">Install</a>
    <a href="/#about">About</a>
    <a href="${REPO}">GitHub</a>
  </nav>
</header>
${body}
<footer class="colophon">
  <span>MIT licensed &middot; <a href="${REPO}">oleg-koval/agent-skills</a></span>
  <span>Lo-fi homage to p2output.com, c. 1998</span>
</footer>
</div>
<script src="/assets/paperbag.js" defer></script>
</body>
</html>
`;

const slab = (label, code) => `<div class="slab">
  <header><span>${esc(label)}</span><button class="copy" type="button">Copy</button></header>
  <pre>${esc(code)}</pre>
</div>`;

/* ------------------------------------------------------------ index page */

const installSection = (sample) => `<section class="band" id="install">
  <h2 data-reactive>Get them</h2>
  <p class="sub">Pick your agent. The canonical package is the same either way; only the wrapper changes.</p>
  <div class="cols">
    <div>
      <h3>Claude Code</h3>
      ${slab("marketplace", "/plugin marketplace add oleg-koval/agent-skills\n/plugin install olko-agent-skills@olko-agent-skills")}
    </div>
    <div>
      <h3>Codex</h3>
      ${slab("symlink install", "git clone https://github.com/oleg-koval/agent-skills.git\ncd agent-skills\n./scripts/install-codex-symlinks.sh")}
    </div>
    <div>
      <h3>Grok</h3>
      ${slab("marketplace", "grok plugin marketplace add oleg-koval/agent-skills")}
    </div>
    <div>
      <h3>Then just ask</h3>
      ${slab("any session", `Use the ${sample} skill.`)}
    </div>
  </div>
  <p class="sub">Cursor, Copilot, Windsurf and Kiro consume the generated wrappers under <code>adapters/&lt;tool&gt;/&lt;plugin&gt;/</code> &mdash; see the <a href="${REPO}#quick-start">repository README</a>.</p>
</section>`;

const card = (pkg) => {
  const search = [pkg.name, pkg.description, pkg.plugin.name, ...(pkg.tags || [])]
    .join(" ")
    .toLowerCase();
  return `<li class="card"
    data-category="${esc(pkg.plugin.name)}"
    data-adapters="${esc((pkg.adapters || []).join(" "))}"
    data-search="${esc(search)}">
    <span class="cat">${esc(pkg.plugin.name.replace(/^olko-/, "").replace(/-/g, " "))}</span>
    <h2><a href="/skills/${esc(pkg.name)}/" data-reactive>${esc(titleCase(pkg.name))}</a></h2>
    <p>${esc(pkg.description)}</p>
    <span class="lookup">${esc(pkg.lookupName)}</span>
    <ul class="tags">${(pkg.tags || [])
      .slice(0, 6)
      .map((t) => `<li>${esc(t)}</li>`)
      .join("")}</ul>
  </li>`;
};

const indexPage = ({ packages, categories, adapters }) => {
  const body = `<section class="hero">
  <p class="kicker">Agent-agnostic skill catalog</p>
  <h1 data-reactive>Skills in a paper bag</h1>
  <div class="stamp" aria-hidden="true">Opinionated<br>by design</div>
  <p class="lede">${packages.length} canonical skills for Codex, Claude, Cursor, Grok, Copilot, Windsurf, Kiro, Pi and Hermes. They encode working defaults and repeatable workflows instead of neutral snippets &mdash; starting points with taste, easy to inspect, specific enough for an agent to execute the same way twice.</p>
</section>

<div class="ticker" aria-hidden="true"><span>${packages
    .map((p) => p.lookupName)
    .join(" &nbsp;&bull;&nbsp; ")}</span></div>

<div class="statbar">
  <div><b>${packages.length}</b><small>Skills</small></div>
  <div><b>${adapters.length}</b><small>Agent adapters</small></div>
  <div><b>${categories.length}</b><small>Plugins</small></div>
</div>

<section class="band" id="catalog">
  <div class="controls">
    <label for="q">Search the catalog</label>
    <input id="q" type="search" autocomplete="off" placeholder="release, pull requests, obsidian, watch face&hellip;">
    <div class="chips" role="group" aria-label="Filter by plugin">
      ${categories
        .map(
          (c) =>
            `<button class="chip" type="button" aria-pressed="false" data-kind="category" data-value="${esc(c.name)}">${esc(c.name.replace(/^olko-/, "").replace(/-/g, " "))} <span aria-hidden="true">${c.count}</span></button>`,
        )
        .join("\n      ")}
    </div>
    <div class="chips" role="group" aria-label="Filter by agent">
      ${adapters
        .map(
          (a) =>
            `<button class="chip" type="button" aria-pressed="false" data-kind="adapter" data-value="${esc(a.name)}">${esc(a.name)} <span aria-hidden="true">${a.count}</span></button>`,
        )
        .join("\n      ")}
    </div>
    <p class="count" id="count" role="status">${packages.length} skills</p>
  </div>
  <ul class="grid" id="grid">
    ${packages.map(card).join("\n    ")}
  </ul>
  <p class="empty" id="empty" hidden>Nothing in the bag matches that.</p>
</section>

${installSection(packages[0].lookupName)}

<section class="band" id="about">
  <h2 data-reactive>About</h2>
  <p class="sub">One canonical package per workflow. Agent-specific wrappers live in <code>adapters/</code> rather than duplicating the skill. Catalogs stay neutral and machine-readable, so this page is generated from <code>catalog/skills.json</code> and can never drift from what actually ships.</p>
  <p class="sub">The styling is a deliberate homage to <strong>p2output.com</strong>, a late-1990s experimental web design and motion graphics project written up in <em>Fresh Styles for Web Designers: Eye Candy from the Underground</em> for its lo-fi paper-bag surface, busy background graphics, and text that lit up as your cursor swept across it. The original domain has been dark for years. Move your pointer over the headlines.</p>
</section>`;

  return layout({
    title: "agent skills — an agent-agnostic skill catalog",
    ogTitle: "agent skills",
    description: `${packages.length} opinionated, agent-agnostic skills for Codex, Claude, Cursor, Grok, Copilot, Windsurf and Kiro.`,
    canonical: `${SITE_URL}/`,
    body,
  });
};

/* ----------------------------------------------------------- detail page */

const detailPage = (pkg, prev, next) => {
  const label = titleCase(pkg.name);
  const body = `<p class="crumb"><a href="/">Catalog</a> / ${esc(pkg.plugin.name.replace(/^olko-/, "").replace(/-/g, " "))}</p>
<div class="detail-head">
  <span class="cat">${esc(pkg.lookupName)}</span>
  <h1 data-reactive>${esc(label)}</h1>
  <p>${esc(pkg.longDescription || pkg.description)}</p>
</div>

<dl class="meta">
  <div><dt>Lookup name</dt><dd>${esc(pkg.lookupName)}</dd></div>
  <div><dt>Plugin</dt><dd>${esc(pkg.plugin.name.replace(/^olko-/, "").replace(/-/g, " "))}</dd></div>
  <div><dt>Agents</dt><dd>${esc((pkg.adapters || []).join(", "))}</dd></div>
  <div><dt>Bundled references</dt><dd>${pkg.supportFiles} file${pkg.supportFiles === 1 ? "" : "s"}</dd></div>
</dl>

<section class="band">
  <h2 data-reactive>Use it</h2>
  <p class="sub">Once the catalog is installed, name the skill in a session.</p>
  ${slab("any agent", `Use the ${pkg.lookupName} skill.`)}
  ${slab("claude code", `/plugin marketplace add oleg-koval/agent-skills\n/plugin install olko-agent-skills@olko-agent-skills`)}
  <p class="sub"><a href="${REPO}/blob/main/${esc(pkg.path)}/SKILL.md">Read the full SKILL.md on GitHub</a> &middot; <a href="${REPO}/tree/main/${esc(pkg.path)}">Browse the package</a></p>
</section>

${
  (pkg.tags || []).length
    ? `<section class="band">
  <h2 data-reactive>Tags</h2>
  <ul class="tags">${pkg.tags.map((t) => `<li><a href="/?q=${encodeURIComponent(t)}">${esc(t)}</a></li>`).join("")}</ul>
</section>`
    : ""
}

<nav class="pager" aria-label="Catalog">
  <a href="/skills/${esc(prev.name)}/">&larr; ${esc(titleCase(prev.name))}</a>
  <a href="/skills/${esc(next.name)}/">${esc(titleCase(next.name))} &rarr;</a>
</nav>`;

  return layout({
    title: `${label} — agent skills`,
    description: pkg.description,
    canonical: `${SITE_URL}/skills/${pkg.name}/`,
    body,
  });
};

/* ------------------------------------------------------------------ main */

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" fill="#c3ac84"/>
<path d="M7 9h18v16H7z" fill="none" stroke="#191410" stroke-width="2.5"/>
<path d="M7 9l4-4h10l4 4" fill="none" stroke="#191410" stroke-width="2.5"/>
<circle cx="16" cy="18" r="3.4" fill="#a8321f"/>
</svg>
`;

const main = async () => {
  const catalog = loadCatalog(join(root, "catalog", "skills.json"));

  const packages = [...catalog.skills].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const pkg of packages) {
    const dir = join(root, pkg.path);
    const front = await readFrontmatter(join(dir, "SKILL.md"));
    // The catalog description is the source of truth; frontmatter only fills
    // the longer detail-page blurb when it is genuinely richer.
    if (front.description && front.description.length > pkg.description.length) {
      pkg.longDescription = front.description;
    }
    pkg.supportFiles = await countSupportFiles(dir);
  }

  const tally = (getValues) => {
    const counts = new Map();
    for (const pkg of packages) {
      const values = getValues(pkg);
      for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  const categories = tally((pkg) => [pkg.plugin.name]);
  const adapters = tally((pkg) => pkg.adapters || []);

  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "assets"), { recursive: true });

  await copyFile(
    join(here, "assets", "paperbag.css"),
    join(out, "assets", "paperbag.css"),
  );
  await copyFile(
    join(here, "assets", "paperbag.js"),
    join(out, "assets", "paperbag.js"),
  );
  await writeFile(join(out, "assets", "favicon.svg"), favicon);

  await writeFile(
    join(out, "index.html"),
    indexPage({ packages, categories, adapters }),
  );

  for (const [i, pkg] of packages.entries()) {
    const prev = packages[(i - 1 + packages.length) % packages.length];
    const next = packages[(i + 1) % packages.length];
    const dir = join(out, "skills", pkg.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), detailPage(pkg, prev, next));
  }

  await writeFile(
    join(out, "404.html"),
    layout({
      title: "Not in the bag — agent skills",
      description: "That page does not exist.",
      canonical: `${SITE_URL}/404.html`,
      body: `<section class="hero">
  <p class="kicker">404</p>
  <h1 data-reactive>Not in the bag</h1>
  <p class="lede">Whatever you reached for is not here. <a href="/">Go back to the catalog</a>.</p>
</section>`,
    }),
  );

  const urls = [`${SITE_URL}/`, ...packages.map((p) => `${SITE_URL}/skills/${p.name}/`)];
  await writeFile(
    join(out, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );
  await writeFile(
    join(out, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`,
  );
  await writeFile(join(out, "CNAME"), `${CNAME}\n`);
  await writeFile(join(out, ".nojekyll"), "");

  console.log(
    `site: ${packages.length} skills, ${categories.length} categories, ${adapters.length} adapters -> _site/`,
  );
};

await main();
