// `SA doctor`: checks what the pipeline needs, sets up the narrator, and renders a 3-second test short.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findChrome } from "./chrome.ts";
import { has } from "./media.ts";
import { HYPERFRAMES, setupNarrator } from "./voice.ts";

const FFMPEG_HINT: Readonly<Record<string, string>> = { darwin: "brew install ffmpeg", win32: "winget install ffmpeg" };
const TEST_SCENE = `window.SCENES = { test: (k) => { k.sky({ stops: ["#3f8ad6", "#e6eef2"] }); k.clouds({}); k.ground({ y: 0.6, color: "#58a531", stripes: 12 }); k.person({ x: 0.5, y: 0.82, h: 0.26, pose: "wave" }); } };`;

type Check = { readonly ok: boolean; readonly msg: string };
const say = (c: Check): Check => (console.log(`${c.ok ? "ok" : "!!"} ${c.msg}`), c);

const node = (): Check => {
  const v = process.versions.node;
  const [major = 0, minor = 0] = v.split(".").map(Number);
  // .ts runs without a flag from 22.18 (type stripping)
  return major > 22 || (major === 22 && minor >= 18) ? { ok: true, msg: `Node ${v}` } : { ok: false, msg: `Node ${v} is too old: install Node 22.18+ from https://nodejs.org` };
};

const ffmpeg = (): Check =>
  has("ffmpeg") ? { ok: true, msg: "ffmpeg" } : { ok: false, msg: `ffmpeg is missing: ${FFMPEG_HINT[process.platform] ?? "sudo apt install ffmpeg"}` };

const chrome = (): Check => {
  const found = findChrome() ?? (console.log("· no Chrome found, fetching the headless one HyperFrames uses..."),
    spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", HYPERFRAMES, "browser", "ensure"], { stdio: "inherit" }), findChrome());
  return found ? { ok: true, msg: `Chrome: ${found.bin}` } : { ok: false, msg: `no Chrome: install Google Chrome, or run npx --yes ${HYPERFRAMES} browser ensure` };
};

function testRender(cli: string, withVoice: boolean): Check {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-test-"));
  fs.writeFileSync(path.join(work, "short.json"), JSON.stringify({
    title: "test", look: "oil", voice: withVoice ? { id: "bm_george" } : "none", music: { mood: "tender" },
    lines: [{ say: "It works.", scene: "test", move: "push" }], tail: 1,
  }));
  fs.writeFileSync(path.join(work, "scenes.js"), TEST_SCENE);
  const r = spawnSync(process.execPath, [cli, "render", work], { stdio: "inherit" });
  const mp4 = path.join(work, "test.mp4");
  return r.status === 0 && fs.existsSync(mp4) ? { ok: true, msg: `test short: ${mp4}` } : { ok: false, msg: "the test render failed (see above)" };
}

/** Returns the exit code. */
export async function doctor(cli: string): Promise<number> {
  const basics = [node, ffmpeg, chrome].map((c) => say(c()));
  if (basics.some((c) => !c.ok)) return 1;
  const why = await setupNarrator();
  const voice = say(why ? { ok: false, msg: why } : { ok: true, msg: "the narrator (Kokoro, runs on this computer)" });
  const render = say(testRender(cli, voice.ok));
  return voice.ok && render.ok ? 0 : 1;
}
