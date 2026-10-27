#!/usr/bin/env node
/*
 * Shorts Animator: a script and a look in, an animated short out.
 *
 *   SA new <dir> [--look oil] [--format 9:16]   a project: short.json, scenes.js
 *   SA looks                                     the looks, moods and voices, one line each
 *   SA check <dir>                               finds what a render would get wrong, in a second, no browser
 *   SA voice <dir>                               narrates every line (cached) and prints the timing
 *   SA frames <dir>                              one painted frame per shot -> frames/sheet.jpg
 *   SA still <dir> <shot> [at]                   one shot, full size -> frames/shot-NN.jpg
 *   SA render <dir>                              the MP4: voice, score, every drawing -> <title>.mp4
 *   SA set <dir> key=value...                    change short.json from the command line (JSON values)
 *   SA doctor                                    checks the machine and renders a 3-second test
 *
 * SA = node <skill-dir>/scripts/sa.ts
 */
import fs from "node:fs";
import path from "node:path";
import { check, report } from "./domain/check.ts";
import { resolveLook, pageState } from "./domain/look.ts";
import { parseAssignment, setPath } from "./domain/patch.ts";
import { isJson, isMap, parseShort } from "./domain/schema.ts";
import { timeline } from "./domain/timeline.ts";
import type { Json, JsonMap, Result, Short, Take, Timeline } from "./domain/types.ts";
import { fail, ok } from "./domain/types.ts";
import type { Page } from "./edge/chrome.ts";
import { doctor } from "./edge/doctor.ts";
import { encoder, jpeg, mkdir, readJson, stillSheet, videoSheet, writeJson } from "./edge/media.ts";
import { pageErrors, paintPage } from "./edge/page.ts";
import { kitNames, probeScenes } from "./edge/probe.ts";
import { MOODS, soundtrack } from "./edge/sound.ts";
import { cachedTakes, narrate } from "./edge/voice.ts";

const LOOKS = path.join(import.meta.dirname, "looks");
const VOICES = "bm_george (warm British man, default), am_michael, am_adam, af_heart, af_nova, bf_emma, bf_isabella";
const NEW_SCENES = `// One function per shot. k is the drawing kit (references/kit.md).
window.SCENES = {
  opening: (k) => {
    k.sky({ stops: ["#f3ecd2", "#e9dfb7"] });
    k.ridge({ y: 0.52, amp: 0.02, freq: 4, color: "#4f7a3a", shape: "bush" });
    k.ground({ y: 0.52, color: "#8fbf3a", far: "#c3cf5a", stripes: 14 });
    k.person({ x: 0.5, y: 0.7, h: 0.22, pose: "walk", facing: "front" });
  },
};
`;

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.errors.join("\n  "));
  return r.value;
};

const slug = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "short";

const twosName = (n: number): string => (n === 1 ? "ones" : n === 2 ? "twos" : `${n}s`);

const lookFiles = (): readonly string[] => fs.readdirSync(LOOKS).filter((f) => f.endsWith(".json")).toSorted();

const namedLook = (name: string): Result<JsonMap> => {
  const f = path.join(LOOKS, `${name}.json`);
  if (!fs.existsSync(f)) return fail(`no look "${name}" (SA looks lists them)`);
  const v = readJson(f);
  return isMap(v) ? ok(v) : fail(`looks/${name}.json is not an object`);
};

const shortFile = (dir: string): string => path.join(dir, "short.json");

function rawShort(dir: string): Json {
  const f = shortFile(dir);
  if (!fs.existsSync(f)) throw new Error(`no short.json in ${dir} (start one with: SA new ${dir})`);
  const v = readJson(f);
  if (!isJson(v)) throw new Error("short.json is not JSON");
  return v;
}

const load = (dir: string): Short => unwrap(parseShort(rawShort(dir)));

type Project = { readonly dir: string; readonly s: Short; readonly takes: readonly Take[]; readonly tl: Timeline };

async function project(dir: string, quiet = false): Promise<Project> {
  const s = load(dir);
  const takes = await narrate(dir, s, quiet);
  return { dir, s, takes, tl: unwrap(timeline(s, takes)) };
}

async function withPage<T>({ dir, s, tl }: Project, use: (pg: Page) => Promise<T>): Promise<T> {
  const state = pageState(s, tl, unwrap(resolveLook(s.look, namedLook)));
  const pg = await paintPage(dir, state, tl.W, tl.H);
  try {
    const out = await use(pg);
    const errs = pageErrors(pg);
    if (errs.length) console.log("⚠ the page said:\n  " + errs.join("\n  "));
    return out;
  } finally {
    pg.close();
  }
}

const frameName = (i: number): string => `s${String(i).padStart(3, "0")}.jpg`;

/* ------------------------------------------------------------------ commands */

type Args = { readonly dir: string | undefined; readonly rest: readonly string[] };
type Command = (a: Args) => Promise<number>;

const need = (dir: string | undefined, usage: string): string => {
  if (!dir) throw new Error(usage);
  return dir;
};

const looks: Command = async () => {
  lookFiles().forEach((f) => {
    const l = readJson(path.join(LOOKS, f));
    console.log(`${f.replace(".json", "").padEnd(12)} ${isMap(l) && typeof l.about === "string" ? l.about : ""}`);
  });
  console.log(`\nmusic moods: ${MOODS.join(", ")} (or "none", or a path to their own track)`);
  console.log(`voices: ${VOICES}`);
  return 0;
};

const create: Command = async ({ dir, rest }) => {
  const d = need(dir, "SA new <dir>");
  mkdir(d, "assets");
  const opt = (k: string, dflt: string): string => {
    const i = rest.indexOf(`--${k}`);
    return (i >= 0 ? rest[i + 1] : undefined) ?? dflt;
  };
  if (!fs.existsSync(shortFile(d))) {
    writeJson(shortFile(d), {
      title: "Untitled short", brief: "", format: opt("format", "9:16"), look: opt("look", "oil"),
      voice: { id: "bm_george", speed: 0.92 }, music: { mood: "tender" }, captions: { style: "box" },
      lines: [{ say: "Every story starts somewhere.", scene: "opening", move: "push" }],
    });
  }
  if (!fs.existsSync(path.join(d, "scenes.js"))) fs.writeFileSync(path.join(d, "scenes.js"), NEW_SCENES);
  console.log(`✓ ${d}\n  short.json  the script, look, voice, music\n  scenes.js   the drawings\n  assets/     anything they gave you`);
  return 0;
};

const set: Command = async ({ dir, rest }) => {
  const d = need(dir, "SA set <dir> key=value...");
  const next = rest.map((a) => unwrap(parseAssignment(a))).reduce<Json>((doc, a) => setPath(doc, a.path, a.value), rawShort(d));
  // Placeholder takes are enough to catch what only the timeline knows (an unknown format).
  const s = unwrap(parseShort(next));
  unwrap(timeline(s, s.lines.map(() => ({ file: null, dur: 1 }))));
  writeJson(shortFile(d), next);
  console.log("✓ short.json updated");
  return 0;
};

const lookKeys = (): readonly string[] =>
  [...new Set(lookFiles().flatMap((f) => {
    const l = readJson(path.join(LOOKS, f));
    return isMap(l) ? Object.keys(l) : [];
  }))];

const checkCmd: Command = async ({ dir }) => {
  const d = need(dir, "SA check <dir>");
  const s = load(d);
  const tl = unwrap(timeline(s, cachedTakes(d, s)));
  const findings = check({ short: s, timeline: tl, probes: probeScenes(d, tl), kit: kitNames(), lookKeys: lookKeys() });
  console.log(report(findings));
  return findings.some((f) => f.level === "error") ? 1 : 0;
};

const voice: Command = async ({ dir }) => {
  const { tl } = await project(need(dir, "SA voice <dir>"));
  tl.beats.forEach((b, i) => console.log(`${String(i + 1).padStart(2)}  ${b.start.toFixed(2).padStart(6)}s  ${b.dur.toFixed(2)}s  ${b.scene.padEnd(16)} ${b.say}`));
  console.log(`total ${tl.duration.toFixed(1)}s, ${tl.beats.length} shots`);
  return 0;
};

const frames: Command = async ({ dir }) => {
  const p = await project(need(dir, "SA frames <dir>"), true);
  const fdir = mkdir(p.dir, "frames");
  fs.readdirSync(fdir).filter((f) => /^s\d+\.jpg$/.test(f)).forEach((f) => fs.rmSync(path.join(fdir, f)));
  await withPage(p, (pg) =>
    p.tl.beats.reduce<Promise<void>>(async (prev, _b, i) => {
      await prev;
      fs.writeFileSync(path.join(fdir, frameName(i)), jpeg(await pg.evaluate(`window.still(${i}, 0.6)`)));
    }, Promise.resolve()),
  );
  const sheet = path.join(fdir, "sheet.jpg");
  stillSheet(p.tl, path.join(fdir, "s%03d.jpg"), sheet);
  console.log(`✓ ${sheet}  (${p.tl.beats.length} shots, ${p.tl.duration.toFixed(1)}s)`);
  return 0;
};

const still: Command = async ({ dir, rest }) => {
  const p = await project(need(dir, "SA still <dir> <shot> [at]"), true);
  const i = Math.max(0, parseInt(rest[0] ?? "1", 10) - 1);
  const at = parseFloat(rest[1] ?? "0.6");
  if (i >= p.tl.beats.length) throw new Error(`shot ${i + 1}? there are ${p.tl.beats.length}`);
  const f = path.join(mkdir(p.dir, "frames"), `shot-${String(i + 1).padStart(2, "0")}.jpg`);
  await withPage(p, async (pg) => fs.writeFileSync(f, jpeg(await pg.evaluate(`window.still(${i}, ${at})`))));
  console.log(`✓ ${f}`);
  return 0;
};

/** Next free vN: one past the highest, so deleting an old render never reuses its number. */
const nextVersion = (rdir: string): number =>
  1 + Math.max(0, ...fs.readdirSync(rdir).flatMap((f) => /^v(\d+)\.mp4$/.exec(f)?.[1] ?? []).map(Number));

async function paintAll(pg: Page, write: (b: Buffer) => Promise<void>, drawings: number): Promise<void> {
  const step = async (d: number): Promise<void> => {
    if (d >= drawings) return;
    await write(jpeg(await pg.evaluate(`window.drawing(${d})`)));
    if (d % 60 === 0) process.stdout.write(`\r· painting ${d}/${drawings} drawings`);
    return step(d + 1);
  };
  await step(0);
  process.stdout.write(`\r· painted ${drawings} drawings          \n`);
}

const render: Command = async ({ dir }) => {
  const t0 = Date.now();
  const p = await project(need(dir, "SA render <dir>"));
  const { tl, s } = p;
  console.log(`· ${tl.beats.length} shots, ${tl.duration.toFixed(1)}s at ${tl.fps} fps, drawn on ${twosName(tl.twos)}`);
  const audio = soundtrack(p.dir, s, tl, p.takes);
  const rdir = mkdir(p.dir, "renders");
  const n = nextVersion(rdir);
  const outV = path.join(rdir, `v${n}.mp4`);
  const enc = encoder(tl, audio, outV);
  await withPage(p, (pg) => paintAll(pg, enc.write, Math.ceil((tl.duration * tl.fps) / tl.twos)));
  const code = await enc.done();
  if (code !== 0) throw new Error(`ffmpeg exited ${code} while encoding`);
  const final = path.join(p.dir, `${slug(s.title)}.mp4`);
  fs.copyFileSync(outV, final);
  fs.copyFileSync(shortFile(p.dir), path.join(rdir, `v${n}.json`));
  const sheet = path.join(mkdir(p.dir, "qa"), "sheet.jpg");
  videoSheet(tl, final, sheet);
  console.log(`✓ ${final}\n  ${tl.duration.toFixed(1)}s · ${tl.W}×${tl.H} · ${((Date.now() - t0) / 1000).toFixed(0)}s to make · check: ${sheet}`);
  return 0;
};

const COMMANDS: Readonly<Record<string, Command>> = {
  looks, new: create, set, check: checkCmd, voice, frames, still, render,
  doctor: async () => doctor(import.meta.filename),
};

const usage = (): string =>
  fs.readFileSync(import.meta.filename, "utf8").split("\n").slice(2, 16).join("\n").replace(/^ \* ?/gm, "");

// stripTypeScriptTypes is stable in practice but flagged experimental; that one notice is noise to a user.
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
