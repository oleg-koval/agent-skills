// `SA check`: catch the defects a render would show, before paying for one. Each rule is a pure
// function over plain facts; the edge gathers the facts (scene probes, kit and look vocabularies).
import { words } from "./captions.ts";
import { isMap } from "./schema.ts";
import type { JsonMap, Short, Timeline } from "./types.ts";

export type Call = { readonly fn: string; readonly opts: JsonMap };
export type Probe = { readonly scene: string; readonly calls: readonly Call[]; readonly error?: string };
export type Facts = {
  readonly short: Short;
  readonly timeline: Timeline;
  readonly probes: readonly Probe[];
  readonly kit: readonly string[];
  readonly lookKeys: readonly string[];
};
export type Finding = { readonly level: "error" | "warn"; readonly where: string; readonly msg: string };

export const MOVES = ["push", "pull", "pan-left", "pan-right", "rise", "fall", "drift", "still"];
export const TRANSITIONS = ["cut", "fade", "dip"];
const LOOK_META = ["base", "palette", "captions", "about"];
const WORDS = { min: 4, max: 12 };
const SECONDS = { min: 20, max: 45 };
const BAND = 0.04;

const err = (where: string, msg: string): Finding => ({ level: "error", where, msg });
const warn = (where: string, msg: string): Finding => ({ level: "warn", where, msg });
const num = (o: JsonMap, k: string, d: number): number => {
  const v = o[k];
  return typeof v === "number" ? v : d;
};

const unknownScenes = ({ timeline, probes }: Facts): readonly Finding[] => {
  const known = new Set(probes.map((p) => p.scene));
  return timeline.beats
    .filter((b) => !known.has(b.scene))
    .map((b) => err(`lines[${b.line}]`, `no scene "${b.scene}" in scenes.js (renders as a red frame)`));
};

const unknownMoves = ({ timeline }: Facts): readonly Finding[] =>
  timeline.beats.flatMap((b) => [
    ...(MOVES.includes(b.move) ? [] : [warn(`lines[${b.line}]`, `move "${b.move}" is not one of ${MOVES.join(", ")}; it renders as still`)]),
    ...(TRANSITIONS.includes(b.transition) ? [] : [warn(`lines[${b.line}]`, `transition "${b.transition}" is not one of ${TRANSITIONS.join(", ")}; it renders as a cut`)]),
  ]);

const unknownLookKeys = ({ short, lookKeys }: Facts): readonly Finding[] => {
  if (!isMap(short.look)) return [];
  const known = new Set([...lookKeys, ...LOOK_META]);
  return Object.keys(short.look)
    .filter((k) => !known.has(k))
    .map((k) => warn("look", `"${k}" is not a look setting; it is ignored`));
};

const lineLengths = ({ short }: Facts): readonly Finding[] =>
  short.lines.flatMap((l, i) => {
    const n = words(l.say).length;
    return n < WORDS.min || n > WORDS.max ? [warn(`lines[${i}]`, `${n} words; lines of ${WORDS.min} to ${WORDS.max} read best`)] : [];
  });

const totalLength = ({ timeline: { duration } }: Facts): readonly Finding[] =>
  duration < SECONDS.min || duration > SECONDS.max
    ? [warn("short", `${duration.toFixed(1)}s long; ${SECONDS.min} to ${SECONDS.max}s holds attention best`)]
    : [];

const sceneErrors = ({ probes }: Facts): readonly Finding[] =>
  probes.flatMap((p) => (p.error === undefined ? [] : [err(`scene "${p.scene}"`, `throws: ${p.error}`)]));

const unknownKit = ({ probes, kit }: Facts): readonly Finding[] => {
  const known = new Set(kit);
  return probes.flatMap((p) =>
    [...new Set(p.calls.map((c) => c.fn))].filter((fn) => !known.has(fn)).map((fn) => err(`scene "${p.scene}"`, `k.${fn} is not in the kit`)),
  );
};

/** A figure whose body spans the caption line gets text drawn across it. */
const crossesBand = (c: Call, y: number): boolean => {
  if (c.fn !== "person") return false;
  const feet = num(c.opts, "y", 0.85);
  const head = feet - num(c.opts, "h", 0.3) * num(c.opts, "scale", 1);
  return head < y + BAND && feet > y - BAND;
};

const captionOverlap = ({ short, timeline, probes }: Facts): readonly Finding[] => {
  if (short.captions.style === "none" || timeline.track.length === 0) return [];
  const y = num(short.captions, "y", 0.775);
  const used = new Set(timeline.beats.map((b) => b.scene));
  return probes
    .filter((p) => used.has(p.scene) && p.calls.some((c) => crossesBand(c, y)))
    .map((p) => warn(`scene "${p.scene}"`, `a person crosses the caption line at y=${y}; raise them, shrink them, or set captions.y`));
};

const RULES = [sceneErrors, unknownScenes, unknownKit, unknownMoves, unknownLookKeys, captionOverlap, lineLengths, totalLength];

export const check = (facts: Facts): readonly Finding[] => RULES.flatMap((rule) => rule(facts));

export const report = (fs: readonly Finding[]): string =>
  fs.length === 0 ? "check: clean" : fs.map((f) => `${f.level === "error" ? "ERROR" : "warn "} ${f.where}: ${f.msg}`).join("\n");
