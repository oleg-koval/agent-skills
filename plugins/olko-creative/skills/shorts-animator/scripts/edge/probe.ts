// `SA check` facts: run every scene once against a recording kit, without a browser.
// The kit records each call it sees, so the domain rules can judge calls, not pixels.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { Call, Probe } from "../domain/check.ts";
import { isMap } from "../domain/schema.ts";
import type { JsonMap, Timeline } from "../domain/types.ts";

const KIT_SRC = path.join(import.meta.dirname, "..", "runtime", "kit.ts");
const IMAGE = /\.(png|jpe?g|webp|svg)$/i;
const VALUES = ["g", "W", "H", "u", "t", "p", "r", "pal", "beat", "mix", "alpha", "rng", "noise1", "X", "Y"];

/** Every name a scene may call or read on k, read from the kit itself so the two cannot drift. */
export const kitNames = (): readonly string[] => [
  ...VALUES,
  ...[...fs.readFileSync(KIT_SRC, "utf8").matchAll(/(\w+): \((?:o|list)\) =>/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
];

const plain = (o: unknown): JsonMap => {
  try {
    const v: unknown = JSON.parse(JSON.stringify(o ?? {}));
    return isMap(v) ? v : {};
  } catch {
    return {};
  }
};

/** A canvas context that accepts anything and draws nothing. */
const sink = (): unknown => {
  const handler: ProxyHandler<() => void> = {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : proxy),
    set: () => true,
    apply: () => proxy,
  };
  const proxy: unknown = new Proxy(() => undefined, handler);
  return proxy;
};

function recordingKit(tl: Timeline, calls: Call[]): object {
  const { W, H } = tl;
  const values: Readonly<Record<string, unknown>> = {
    g: sink(), W, H, u: H / 1920, t: 0.6, p: 0.6, X: (x: number) => x * W, Y: (y: number) => y * H,
    r: () => 0.5, rng: () => () => 0.5, noise1: () => 0.5, mix: () => "#808080", alpha: () => "#808080", pal: {}, beat: tl.beats[0] ?? {},
  };
  const record = (fn: string) => (o: unknown) => {
    if (fn === "people" && Array.isArray(o)) o.forEach((x) => calls.push({ fn: "person", opts: plain(x) }));
    else calls.push({ fn, opts: plain(o) });
  };
  return new Proxy({}, { get: (_t, key) => (typeof key !== "string" ? undefined : key in values ? values[key] : record(key)) });
}

const message = (e: unknown): string =>
  typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e);

/** One probe per scene in scenes.js; a scene that throws (or runs past a second) reports that instead. */
export function probeScenes(dir: string, tl: Timeline): readonly Probe[] {
  const assets = path.join(dir, "assets");
  const names = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => IMAGE.test(f)) : [];
  // The page loads assets/ into IMAGES before the scenes run; a stand-in of the same shape keeps them honest here.
  const IMAGES = Object.fromEntries(names.map((f) => [f.replace(/\.[^.]+$/, ""), { width: 512, height: 512 }]));
  const ctx = vm.createContext({ window: { IMAGES }, IMAGES });
  vm.runInContext(fs.readFileSync(path.join(dir, "scenes.js"), "utf8"), ctx, { filename: "scenes.js", timeout: 1000 });
  const scenes: unknown = vm.runInContext("Object.keys(window.SCENES || {})", ctx);
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("scenes.js sets no window.SCENES");
  return scenes.map(String).map((scene): Probe => {
    const calls: Call[] = [];
    try {
      vm.runInContext(`window.SCENES[${JSON.stringify(scene)}](globalThis.__kit)`, Object.assign(ctx, { __kit: recordingKit(tl, calls) }), { timeout: 1000 });
      return { scene, calls };
    } catch (e) {
      return { scene, calls, error: message(e) };
    }
  });
}
