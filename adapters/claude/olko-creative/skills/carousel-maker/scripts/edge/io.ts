// Every process, browser and disk write the tool makes, kept out of the domain.
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { H, W } from "../domain/layout.ts";
import type { Json } from "../domain/types.ts";

export function run(cmd: string, args: readonly string[], opts: SpawnSyncOptions = {}): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26, timeout: 120_000, ...opts });
  if (r.status !== 0) {
    const out = String(r.stderr || r.stdout || r.error?.message || "");
    throw new Error(`${path.basename(cmd)} ${args.slice(0, 2).join(" ")}... failed:\n${out.slice(-1500)}`);
  }
  return String(r.stdout ?? "");
}

export const has = (cmd: string): boolean => spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0;
export const readJson = (f: string): unknown => JSON.parse(fs.readFileSync(f, "utf8"));
export const writeJson = (f: string, v: Json | object): void => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
export const mkdir = (...parts: string[]): string => {
  const d = path.join(...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
export const writeNew = (f: string, text: string): boolean => {
  if (fs.existsSync(f)) return false;
  fs.writeFileSync(f, text);
  return true;
};

export type Chrome = { readonly bin: string; readonly shell: boolean };

const SHELL = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
const SYSTEM: Readonly<Record<string, readonly string[]>> = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
  win32: [
    `${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
};

const dirs = (d: string): readonly string[] =>
  fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) : [];

/** The headless shell shorts-animator's doctor (via HyperFrames) downloads, newest first. */
const cachedShell = (): string | undefined =>
  dirs(path.join(os.homedir(), ".cache/hyperframes/chrome/chrome-headless-shell"))
    .toSorted()
    .reverse()
    .flatMap((v) => dirs(v).map((sub) => path.join(sub, SHELL)))
    .find((f) => fs.existsSync(f));

export function findChrome(): Chrome | undefined {
  const env = process.env.CHROME;
  if (env && fs.existsSync(env)) return { bin: env, shell: /headless-shell/.test(env) };
  const sys = (SYSTEM[process.platform] ?? []).find((c) => fs.existsSync(c));
  if (sys) return { bin: sys, shell: false };
  const shell = cachedShell();
  return shell ? { bin: shell, shell: true } : undefined;
}

// One short-lived browser per call: no DevTools socket to manage, and a crash costs one slide.
const flags = (c: Chrome, height: number): readonly string[] => [
  ...(c.shell ? [] : ["--headless"]), "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
  "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check", `--window-size=${W},${height}`,
];

export const url = (file: string): string => pathToFileURL(path.resolve(file)).href;

export const screenshot = (c: Chrome, html: string, png: string): void =>
  void run(c.bin, [...flags(c, H), `--screenshot=${png}`, url(html)], { stdio: ["ignore", "ignore", "pipe"] });

/** The DOM after load, images and fonts included (the virtual time budget waits for them). */
export const dumpDom = (c: Chrome, html: string, height: number): string =>
  run(c.bin, [...flags(c, height), "--virtual-time-budget=5000", "--dump-dom", url(html)]);

export const sheet = (pattern: string, count: number, out: string): boolean => {
  if (!has("ffmpeg")) return false;
  const cols = Math.min(count, 5);
  run("ffmpeg", ["-v", "error", "-y", "-start_number", "1", "-framerate", "1", "-i", pattern,
    "-vf", `scale=360:-2,tile=${cols}x${Math.ceil(count / cols)}:padding=8:color=white`, "-frames:v", "1", out]);
  return true;
};
