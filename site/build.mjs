#!/usr/bin/env node
/*
 * Static site generator for the agent-skills catalog.
 *
 * Reads the machine-readable catalog and emits a dependency-free site into
 * `_site/`. The catalog stays the source of truth for plugin and skill data.
 */

import { mkdir, readFile, readdir, copyFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../scripts/lib/catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "_site");

const SITE_URL = "https://skills.olegkoval.com";
const PORTFOLIO = "https://www.olegkoval.com";
const REPO = "https://github.com/oleg-koval/agent-skills";
const CNAME = "skills.olegkoval.com";
const GA_MEASUREMENT_ID = "G-NV8Q2H8YV0";
const MARKETPLACE_NAME = "olko-agent-skills";
const assetVersion = createHash("sha256")
  .update(await readFile(join(here, "assets", "catalog.css")))
  .update(await readFile(join(here, "assets", "catalog.js")))
  .digest("hex")
  .slice(0, 10);

const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const titleCase = (slug) =>
  slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const displayPlugin = (name) => name.replace(/^olko-/, "").replace(/-/g, " ");

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

const countSupportFiles = async (dir) => {
  let files = 0;
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "adapters") continue;
      if (entry.isDirectory()) await walk(join(current, entry.name));
      else if (entry.name !== "SKILL.md") files += 1;
    }
  };
  if (existsSync(dir)) await walk(dir);
  return files;
};

const layout = ({ title, description, canonical, body, ogTitle, pageType }) => `<!doctype html>
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
<meta name="theme-color" content="#f5f7f4">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/catalog.css?v=${assetVersion}">
</head>
<body data-page-type="${esc(pageType)}" data-ga-measurement-id="${GA_MEASUREMENT_ID}">
<a class="skip-link" href="#main">Skip to content</a>
<div class="shell">
<header class="masthead">
  <div class="identity">
    <a class="wordmark" href="/" aria-label="Agent Skills home"><span aria-hidden="true">as</span>agent skills</a>
    <a class="maker" href="${PORTFOLIO}" data-analytics-event="portfolio_visit" data-analytics-location="header">by Oleg Koval <span aria-hidden="true">↗</span></a>
  </div>
  <nav aria-label="Primary">
    <a href="/#marketplace">Marketplace</a>
    <a href="/#catalog">Skills</a>
    <a href="/#install">Install</a>
    <a href="${REPO}" data-analytics-event="github_visit" data-analytics-location="header">GitHub <span aria-hidden="true">↗</span></a>
  </nav>
</header>
<main id="main">${body}</main>
<footer class="colophon">
  <p>Open source under MIT. Built and maintained by <a href="${PORTFOLIO}" data-analytics-event="portfolio_visit" data-analytics-location="footer">Oleg Koval</a>.</p>
  <div>
    <button class="text-button" type="button" data-consent-open>Analytics preferences</button>
    <a href="${REPO}">Source</a>
  </div>
</footer>
</div>
<section class="consent" data-consent-banner hidden aria-label="Analytics preference">
  <div>
    <strong>Optional traffic analytics</strong>
    <p>Off until you allow. Page and install interaction counts help improve this catalog. Search text is never sent.</p>
  </div>
  <div class="consent-actions">
    <button class="button button-secondary" type="button" data-consent-decline>Decline</button>
    <button class="button button-primary" type="button" data-consent-accept>Allow analytics</button>
  </div>
</section>
<script src="/assets/catalog.js?v=${assetVersion}" defer></script>
</body>
</html>
`;

const command = (label, code, analytics = {}) => `<div class="command">
  <div class="command-head"><span>${esc(label)}</span><button class="copy" type="button" data-copy ${Object.entries(analytics)
    .map(([key, value]) => `data-analytics-${esc(key)}="${esc(value)}"`)
    .join(" ")}>Copy</button></div>
  <pre>${esc(code)}</pre>
</div>`;

const pluginCard = (plugin) => {
  const install = `/plugin install ${plugin.name}@${MARKETPLACE_NAME}`;
  return `<article class="plugin-card">
    <div class="plugin-card-main">
      <span class="eyebrow">${plugin.count} skill${plugin.count === 1 ? "" : "s"}</span>
      <h3><a href="/?category=${encodeURIComponent(plugin.name)}#catalog">${esc(plugin.name)}</a></h3>
      <p>${esc(plugin.description)}</p>
    </div>
    <div class="install-line">
      <code>${esc(install)}</code>
      <button class="copy-icon" type="button" data-copy data-analytics-event="marketplace_install_copy" data-analytics-plugin="${esc(plugin.name)}" aria-label="Copy install command for ${esc(plugin.name)}">Copy</button>
    </div>
  </article>`;
};

const installSection = (sample) => `<section class="section" id="install">
  <div class="section-heading">
    <div>
      <p class="eyebrow">Installation</p>
      <h2>Use the same catalog anywhere.</h2>
    </div>
    <p>Marketplace installs are quickest in Claude Code and Grok. Codex and the other adapters use the same canonical skill packages.</p>
  </div>
  <div class="install-grid">
    <article>
      <h3>Claude Code</h3>
      <p>Add the marketplace once. Then copy a plugin command from the shelf above.</p>
      ${command("Marketplace", "/plugin marketplace add oleg-koval/agent-skills", { event: "marketplace_add_copy", agent: "claude" })}
    </article>
    <article>
      <h3>Codex</h3>
      <p>Clone the catalog and link its canonical packages into your local skills directory.</p>
      ${command("Local install", "git clone https://github.com/oleg-koval/agent-skills.git\ncd agent-skills\n./scripts/install-codex-symlinks.sh", { event: "catalog_install_copy", agent: "codex" })}
    </article>
    <article>
      <h3>Grok</h3>
      <p>Add the public marketplace. Its generated wrappers stay in sync with the source skills.</p>
      ${command("Marketplace", "grok plugin marketplace add oleg-koval/agent-skills", { event: "marketplace_add_copy", agent: "grok" })}
    </article>
    <article>
      <h3>Then ask directly</h3>
      <p>Skills can be discovered automatically or named explicitly in a session.</p>
      ${command("Any agent", `Use the ${sample} skill.`, { event: "skill_prompt_copy", agent: "any" })}
    </article>
  </div>
  <p class="section-note">Cursor, Copilot, Windsurf, Kiro, Pi and Hermes wrappers live under <code>adapters/</code>. See the <a href="${REPO}#quick-start">installation guide</a> for agent-specific paths.</p>
</section>`;

const skillCard = (pkg) => {
  const search = [pkg.name, pkg.description, pkg.plugin.name, ...(pkg.tags || [])]
    .join(" ")
    .toLowerCase();
  return `<li class="skill-card"
    data-category="${esc(pkg.plugin.name)}"
    data-adapters="${esc((pkg.adapters || []).join(" "))}"
    data-search="${esc(search)}">
    <div class="skill-card-top">
      <span>${esc(displayPlugin(pkg.plugin.name))}</span>
      <code>${esc(pkg.lookupName)}</code>
    </div>
    <h3><a href="/skills/${esc(pkg.name)}/" data-analytics-event="skill_open" data-analytics-skill="${esc(pkg.name)}">${esc(titleCase(pkg.name))}</a></h3>
    <p>${esc(pkg.description)}</p>
    <ul class="tags">${(pkg.tags || [])
      .slice(0, 4)
      .map((tag) => `<li>${esc(tag)}</li>`)
      .join("")}</ul>
  </li>`;
};

const indexPage = ({ packages, plugins, categories, adapters }) => {
  const body = `<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">Agent workflows by Oleg Koval</p>
    <h1>Useful workflows, ready for your agent.</h1>
    <p class="lede">A public marketplace of opinionated skills for shipping software, running products, and maintaining the work around them. Install by plugin, inspect every source file, and keep the same workflow across agents.</p>
    <div class="hero-actions">
      <a class="button button-primary" href="#marketplace">Browse marketplace</a>
      <a class="button button-secondary" href="${REPO}" data-analytics-event="github_visit" data-analytics-location="hero">View source</a>
    </div>
    <p class="facts"><strong>${packages.length}</strong> skills <span>·</span> <strong>${plugins.length}</strong> plugins <span>·</span> <strong>${adapters.length}</strong> agent adapters</p>
  </div>
  <aside class="hero-command" aria-label="Quick marketplace install">
    <p class="eyebrow">Start here</p>
    <h2>Add the marketplace once.</h2>
    ${command("Claude Code", "/plugin marketplace add oleg-koval/agent-skills", { event: "marketplace_add_copy", agent: "claude" })}
    <p>Then choose one focused plugin below. You can add more later without installing the whole catalog.</p>
  </aside>
</section>

<section class="section marketplace" id="marketplace">
  <div class="section-heading">
    <div>
      <p class="eyebrow">Marketplace plugins</p>
      <h2>Install by the work you do.</h2>
    </div>
    <p>Each plugin is a focused bundle. Copy its Claude Code install command, or open it to see the individual skills it includes.</p>
  </div>
  <div class="plugin-grid">
    ${plugins.map(pluginCard).join("\n    ")}
  </div>
</section>

<section class="section catalog" id="catalog">
  <div class="section-heading">
    <div>
      <p class="eyebrow">Skill catalog</p>
      <h2>Inspect before you install.</h2>
    </div>
    <p>Search the complete source-backed catalog, then narrow it by plugin or supported agent.</p>
  </div>
  <div class="controls">
    <label for="q">Search skills</label>
    <input id="q" type="search" autocomplete="off" placeholder="Pull requests, releases, analytics, watch faces...">
    <details>
      <summary>Filter by plugin <span aria-hidden="true"></span></summary>
      <div class="chips" role="group" aria-label="Filter by plugin">
        ${categories
          .map(
            (category) =>
              `<button class="chip" type="button" aria-pressed="false" data-kind="category" data-value="${esc(category.name)}">${esc(displayPlugin(category.name))} <span>${category.count}</span></button>`,
          )
          .join("\n        ")}
      </div>
    </details>
    <details>
      <summary>Filter by agent <span aria-hidden="true"></span></summary>
      <div class="chips" role="group" aria-label="Filter by agent">
        ${adapters
          .map(
            (adapter) =>
              `<button class="chip" type="button" aria-pressed="false" data-kind="adapter" data-value="${esc(adapter.name)}">${esc(adapter.name)} <span>${adapter.count}</span></button>`,
          )
          .join("\n        ")}
      </div>
    </details>
    <p class="count" id="count" role="status">${packages.length} skills</p>
  </div>
  <ul class="skill-grid" id="grid">
    ${packages.map(skillCard).join("\n    ")}
  </ul>
  <p class="empty" id="empty" hidden>No skills match those filters.</p>
</section>

${installSection(packages[0].lookupName)}

<section class="section about" id="about">
  <div class="section-heading">
    <div>
      <p class="eyebrow">How it stays useful</p>
      <h2>One source, many agents.</h2>
    </div>
    <p>Every workflow has one canonical skill package. Tool-specific adapters are generated from it, so the marketplace, source files, and this site stay aligned.</p>
  </div>
  <a class="quiet-link" href="${PORTFOLIO}" data-analytics-event="portfolio_visit" data-analytics-location="about">More open-source work and writing at olegkoval.com <span aria-hidden="true">↗</span></a>
</section>`;

  return layout({
    title: "Agent Skills by Oleg Koval",
    ogTitle: "Agent Skills",
    description: `${packages.length} open-source agent skills packaged for Claude Code, Codex, Grok, Cursor, Copilot, Windsurf, Kiro, Pi and Hermes.`,
    canonical: `${SITE_URL}/`,
    body,
    pageType: "catalog",
  });
};

const detailPage = (pkg, prev, next) => {
  const label = titleCase(pkg.name);
  const body = `<p class="crumb"><a href="/">Skills</a><span>/</span><a href="/?category=${encodeURIComponent(pkg.plugin.name)}#catalog">${esc(displayPlugin(pkg.plugin.name))}</a></p>
<header class="detail-head">
  <p class="eyebrow">${esc(pkg.lookupName)}</p>
  <h1>${esc(label)}</h1>
  <p>${esc(pkg.longDescription || pkg.description)}</p>
</header>

<dl class="meta">
  <div><dt>Plugin</dt><dd>${esc(pkg.plugin.name)}</dd></div>
  <div><dt>Agents</dt><dd>${esc((pkg.adapters || []).join(", "))}</dd></div>
  <div><dt>Bundled references</dt><dd>${pkg.supportFiles} file${pkg.supportFiles === 1 ? "" : "s"}</dd></div>
</dl>

<section class="section detail-use">
  <div class="section-heading">
    <div><p class="eyebrow">Install and use</p><h2>Add its plugin, then ask.</h2></div>
    <p>The marketplace command is needed once per Claude Code setup. The plugin command installs this skill and its related workflows.</p>
  </div>
  <div class="install-grid">
    <article>${command("Add marketplace", "/plugin marketplace add oleg-koval/agent-skills", { event: "marketplace_add_copy", agent: "claude" })}</article>
    <article>${command("Install plugin", `/plugin install ${pkg.plugin.name}@${MARKETPLACE_NAME}`, { event: "marketplace_install_copy", plugin: pkg.plugin.name })}</article>
    <article>${command("Invoke skill", `Use the ${pkg.lookupName} skill.`, { event: "skill_prompt_copy", skill: pkg.name })}</article>
  </div>
  <p class="section-note"><a href="${REPO}/blob/main/${esc(pkg.path)}/SKILL.md">Read the full SKILL.md</a> <span>·</span> <a href="${REPO}/tree/main/${esc(pkg.path)}">Browse package files</a></p>
</section>

${
  (pkg.tags || []).length
    ? `<section class="section compact-section"><p class="eyebrow">Tags</p><ul class="tags detail-tags">${pkg.tags.map((tag) => `<li><a href="/?q=${encodeURIComponent(tag)}#catalog">${esc(tag)}</a></li>`).join("")}</ul></section>`
    : ""
}

<nav class="pager" aria-label="Skill catalog">
  <a href="/skills/${esc(prev.name)}/"><span>Previous</span>${esc(titleCase(prev.name))}</a>
  <a href="/skills/${esc(next.name)}/"><span>Next</span>${esc(titleCase(next.name))}</a>
</nav>`;

  return layout({
    title: `${label} | Agent Skills`,
    description: pkg.description,
    canonical: `${SITE_URL}/skills/${pkg.name}/`,
    body,
    pageType: "skill",
  });
};

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="8" fill="#365b4a"/>
<path d="M9 10h14M9 16h14M9 22h9" fill="none" stroke="#f5f7f4" stroke-width="2.5" stroke-linecap="round"/>
</svg>
`;

const main = async () => {
  const catalog = loadCatalog(join(root, "catalog", "skills.json"));
  const packages = [...catalog.skills].sort((a, b) => a.name.localeCompare(b.name));

  for (const pkg of packages) {
    const dir = join(root, pkg.path);
    const front = await readFrontmatter(join(dir, "SKILL.md"));
    if (front.description && front.description.length > pkg.description.length) {
      pkg.longDescription = front.description;
    }
    pkg.supportFiles = await countSupportFiles(dir);
  }

  const tally = (getValues) => {
    const counts = new Map();
    for (const pkg of packages) {
      for (const value of getValues(pkg)) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  const categories = tally((pkg) => [pkg.plugin.name]);
  const adapters = tally((pkg) => pkg.adapters || []);
  const plugins = catalog.plugins.map((plugin) => ({
    name: plugin.name,
    description: plugin.description,
    count: plugin.skills.length,
  }));

  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "assets"), { recursive: true });
  await copyFile(join(here, "assets", "catalog.css"), join(out, "assets", "catalog.css"));
  await copyFile(join(here, "assets", "catalog.js"), join(out, "assets", "catalog.js"));
  await writeFile(join(out, "assets", "favicon.svg"), favicon);
  await writeFile(join(out, "index.html"), indexPage({ packages, plugins, categories, adapters }));

  for (const [index, pkg] of packages.entries()) {
    const prev = packages[(index - 1 + packages.length) % packages.length];
    const next = packages[(index + 1) % packages.length];
    const dir = join(out, "skills", pkg.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), detailPage(pkg, prev, next));
  }

  await writeFile(
    join(out, "404.html"),
    layout({
      title: "Page not found | Agent Skills",
      description: "That page does not exist.",
      canonical: `${SITE_URL}/404.html`,
      pageType: "not-found",
      body: `<section class="not-found"><p class="eyebrow">404</p><h1>That skill is not here.</h1><p>Return to the catalog to find another workflow.</p><a class="button button-primary" href="/">Browse skills</a></section>`,
    }),
  );

  const urls = [`${SITE_URL}/`, ...packages.map((pkg) => `${SITE_URL}/skills/${pkg.name}/`)];
  await writeFile(
    join(out, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((url) => `  <url><loc>${url}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );
  await writeFile(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  await writeFile(join(out, "CNAME"), `${CNAME}\n`);
  await writeFile(join(out, ".nojekyll"), "");

  console.log(`site: ${packages.length} skills, ${categories.length} categories, ${adapters.length} adapters -> _site/`);
};

await main();
