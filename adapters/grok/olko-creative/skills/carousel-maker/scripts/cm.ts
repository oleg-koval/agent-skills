#!/usr/bin/env node
/*
 * Carousel Maker: a brand and a few lines of copy in, Instagram carousel slides out.
 *
 *   CM new <dir> [--name "Brand"] [--handle @x] [--look ink]   brand.json, decks/example.json, art/
 *   CM check <dir> [deck]                                        what a render would get wrong, no browser
 *   CM art <dir> [scene...]                                      draws the library: art/scenes.js -> library/<scene>.jpg
 *   CM render <dir> [deck]                                       slides -> out/<deck>/slide-N.png, sheet.jpg, caption.txt
 *
 * CM = node <skill-dir>/scripts/cm.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { check, fitFindings, report, type Finding, type Fit } from "./domain/check.ts";
import { contexts, H, MEASURE, page, section } from "./domain/layout.ts";
import { isMap, parseBrand, parseDeck } from "./domain/schema.ts";
import type { Art, Brand, Deck, Json, Result } from "./domain/types.ts";
import { dumpDom, findChrome, mkdir, readJson, screenshot, sheet, url, writeJson, writeNew } from "./edge/io.ts";

type Args = { readonly dir: string | undefined; readonly rest: readonly string[] };
type Command = (a: Args) => Promise<number>;

const SA = process.env.SHORTS_ANIMATOR ?? path.join(import.meta.dirname, "../../shorts-animator/scripts/sa.ts");
const ART_LOOKS = ["ink", "gouache", "watercolor", "pastel", "oil"];

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.errors.join("\n  "));
  return r.value;
};
const need = (dir: string | undefined, usage: string): string => {
  if (!dir) throw new Error(`usage: ${usage}`);
  return dir;
};
const opt = (rest: readonly string[], k: string, dflt: string): string => {
  const i = rest.indexOf(`--${k}`);
  return (i >= 0 ? rest[i + 1] : undefined) ?? dflt;
};
const positional = (rest: readonly string[]): readonly string[] =>
  rest.filter((a, i) => !a.startsWith("--") && !(rest[i - 1] ?? "").startsWith("--"));

const brandOf = (d: string): Brand => unwrap(parseBrand(readJson(path.join(d, "brand.json"))));
const deckFiles = (d: string, only?: string): readonly string[] => {
  const ddir = path.join(d, "decks");
  const all = fs.existsSync(ddir) ? fs.readdirSync(ddir).filter((f) => f.endsWith(".json")).toSorted() : [];
  const picked = only ? all.filter((f) => f === `${only.replace(/\.json$/, "")}.json`) : all;
  if (picked.length === 0) throw new Error(only ? `no deck decks/${only}.json` : `no decks in ${ddir}`);
  return picked.map((f) => path.join(ddir, f));
};
const deckOf = (f: string): Deck => {
  const r = parseDeck(readJson(f));
  if (!r.ok) throw new Error(`${path.basename(f)}:\n  ${r.errors.join("\n  ")}`);
  return r.value;
};
const library = (d: string): readonly string[] => {
  const ldir = path.join(d, "library");
  return fs.existsSync(ldir) ? fs.readdirSync(ldir).filter((f) => f.endsWith(".jpg")).map((f) => f.slice(0, -4)) : [];
};
const artPath = (d: string, a: Art): string | undefined =>
  a.kind === "library" ? path.join(d, "library", `${a.name}.jpg`) : a.kind === "file" ? path.resolve(d, a.file) : undefined;

const deckFindings = (d: string, deck: Deck): readonly Finding[] =>
  check({
    deck, library: library(d),
    files: deck.slides.flatMap((s) => (s.art.kind === "file" && fs.existsSync(path.resolve(d, s.art.file)) ? [s.art.file] : [])),
  });

const sa = (args: readonly string[]): number => {
  if (!fs.existsSync(SA)) throw new Error(`shorts-animator not found at ${SA}; install it next to this skill or set SHORTS_ANIMATOR`);
  return spawnSync(process.execPath, [SA, ...args], { stdio: "inherit" }).status ?? 1;
};

const EXAMPLE_DECK = {
  title: "Example",
  caption: "The post text under the carousel. Two short lines and one question for the comments.",
  slides: [
    { kind: "cover", title: "Five-word promise goes here", body: "One line on who it is for.", art: "cover" },
    { kind: "point", title: "First step, short", body: "One or two plain sentences that make it concrete." },
    { kind: "point", title: "Second step, short", body: "One or two plain sentences that make it concrete." },
    { kind: "cta", title: "Save this for later", body: "Try one step today.", follow: "Follow for more." },
  ],
};
const EXAMPLE_SCENES = `// One function per library drawing, named the way decks refer to it ("art": "cover").
// k is the shorts-animator kit (../shorts-animator/references/kit.md). One big subject, 1:1, brand colours.
window.SCENES = {
  cover: (k) => {
    k.sky({ stops: ["#f4efe3", "#e8dcc4"] });
    k.sun({ x: 0.5, y: 0.45, r: 0.18, color: "#e0783a" });
  },
};
`;

const create: Command = async ({ dir, rest }) => {
  const d = need(dir, "CM new <dir>");
  mkdir(d, "decks");
  mkdir(d, "library");
  const name = opt(rest, "name", "Untitled brand");
  const look = opt(rest, "look", "ink");
  if (!ART_LOOKS.includes(look)) throw new Error(`--look must be one of ${ART_LOOKS.join(", ")}`);
  writeNew(path.join(d, "brand.json"), JSON.stringify({ name, handle: opt(rest, "handle", ""), look,
    colors: { paper: "#f4efe3", ink: "#1b1712", accent: "#e0783a", muted: "#6b6257" },
    fonts: { head: "Georgia, serif", body: '"Helvetica Neue", Helvetica, Arial, sans-serif' } }, null, 2) + "\n");
  writeNew(path.join(d, "decks", "example.json"), JSON.stringify(EXAMPLE_DECK, null, 2) + "\n");
  const art = path.join(d, "art");
  if (!fs.existsSync(path.join(art, "short.json")) && fs.existsSync(SA)) {
    sa(["new", art, "--look", look, "--format", "1:1"]);
    fs.writeFileSync(path.join(art, "scenes.js"), EXAMPLE_SCENES);
  }
  console.log(`✓ ${d}\n  brand.json   name, handle, colours, fonts, art look\n  decks/       one JSON per carousel\n  art/         the drawings (scenes.js), drawn once per brand\n  library/     the drawn pictures decks pick from`);
  return 0;
};

const checkCmd: Command = async ({ dir, rest }) => {
  const d = need(dir, "CM check <dir> [deck]");
  brandOf(d);
  const results = deckFiles(d, positional(rest)[0]).map((f) => {
    const found = deckFindings(d, deckOf(f));
    console.log(`${path.basename(f, ".json")}: ${report(found)}`);
    return found;
  });
  return results.flat().some((f) => f.level === "error") ? 1 : 0;
};

/** Every library name any deck asks for, in first-use order. */
const wanted = (d: string): readonly string[] => [
  ...new Set(deckFiles(d).flatMap((f) => deckOf(f).slides.flatMap((s) => (s.art.kind === "library" ? [s.art.name] : [])))),
];

const art: Command = async ({ dir, rest }) => {
  const d = need(dir, "CM art <dir> [scene...]");
  const names = positional(rest).length > 0 ? positional(rest) : wanted(d);
  if (names.length === 0) throw new Error("no deck asks for a library drawing; add \"art\": \"<scene>\" to a slide or name scenes");
  const adir = path.join(d, "art");
  const short = fs.existsSync(path.join(adir, "short.json")) ? readJson(path.join(adir, "short.json")) : {};
  const base: { readonly [k: string]: Json } = isMap(short) ? short : {};
  // One still line per drawing, so frame N is drawing N; no voice, music or captions to pay for.
  writeJson(path.join(mkdir(adir), "short.json"), {
    ...base, title: `${brandOf(d).name} art`, format: "1:1", voice: "none", music: "none", captions: { style: "none" },
    lines: names.map((n) => ({ say: `the ${n} drawing for a carousel slide`, scene: n, move: "still" })),
  });
  if (sa(["check", adir]) !== 0) return 1;
  if (sa(["frames", adir]) !== 0) return 1;
  const ldir = mkdir(d, "library");
  names.forEach((n, i) => fs.copyFileSync(path.join(adir, "frames", `s${String(i).padStart(3, "0")}.jpg`), path.join(ldir, `${n}.jpg`)));
  console.log(`✓ ${names.length} drawings -> ${ldir}\n  look once at ${path.join(adir, "frames", "sheet.jpg")}`);
  return 0;
};

const fitOf = (dom: string): readonly Fit[] => {
  const m = /<pre id="fit">([^<]*)<\/pre>/.exec(dom);
  const raw: unknown = m?.[1] ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) : [];
  return Array.isArray(raw)
    ? raw.flatMap((x: unknown) => (isMap(x) && typeof x["slide"] === "number"
      ? [{ slide: x["slide"], overflow: x["overflow"] === true, missingArt: x["missingArt"] === true }] : []))
    : [];
};

const renderDeck = (d: string, brand: Brand, f: string): readonly Finding[] => {
  const deck = deckOf(f);
  const before = deckFindings(d, deck);
  if (before.some((x) => x.level === "error")) return before;
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome found; install Chrome or set CHROME=/path/to/chrome");
  const out = mkdir(d, "out", path.basename(f, ".json"));
  const srcs = deck.slides.map((s) => {
    const p = artPath(d, s.art);
    return p ? url(p) : undefined;
  });
  const ctxs = contexts(brand, deck.slides, srcs);
  const sections = deck.slides.flatMap((s, i) => {
    const c = ctxs[i];
    return c ? [section(s, c)] : [];
  });
  const deckHtml = path.join(out, "deck.html");
  fs.writeFileSync(deckHtml, page(brand, sections.join(""), MEASURE));
  const fit = fitFindings(fitOf(dumpDom(chrome, deckHtml, H)));
  sections.forEach((s, i) => {
    const html = path.join(out, `slide-${i + 1}.html`);
    fs.writeFileSync(html, page(brand, s));
    screenshot(chrome, html, path.join(out, `slide-${i + 1}.png`));
  });
  fs.writeFileSync(path.join(out, "caption.txt"), (deck.caption ?? "") + "\n");
  const sheetFile = path.join(out, "sheet.jpg");
  const made = sheet(path.join(out, "slide-%d.png"), deck.slides.length, sheetFile);
  console.log(`✓ ${deck.slides.length} slides -> ${out}${made ? `\n  look once at ${sheetFile}` : "\n  (no ffmpeg: no contact sheet)"}`);
  return [...before, ...fit];
};

const render: Command = async ({ dir, rest }) => {
  const d = need(dir, "CM render <dir> [deck]");
  const brand = brandOf(d);
  const found = deckFiles(d, positional(rest)[0]).flatMap((f) => {
    const r = renderDeck(d, brand, f);
    if (r.length > 0) console.log(`${path.basename(f, ".json")}: ${report(r)}`);
    return r;
  });
  return found.some((f) => f.level === "error") ? 1 : 0;
};

const COMMANDS: Readonly<Record<string, Command>> = { new: create, check: checkCmd, art, render };

const usage = (): string => fs.readFileSync(import.meta.filename, "utf8").split("\n").slice(2, 11).join("\n").replace(/^ \* ?/gm, "");

process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (!(w.name === "ExperimentalWarning" && /stripTypeScriptTypes/.test(w.message))) console.error(`${w.name}: ${w.message}`);
});

const [cmd = "", dirArg, ...rest] = process.argv.slice(2);
const command = COMMANDS[cmd];
if (!command) {
  console.log(usage());
  process.exit(cmd ? 1 : 0);
}
command({ dir: dirArg ? path.resolve(dirArg) : undefined, rest })
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error("✗ " + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  });
