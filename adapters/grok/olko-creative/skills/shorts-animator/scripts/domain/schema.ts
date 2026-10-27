// short.json arrives as unknown JSON; this is the one place it is narrowed into a Short.
import type { Json, JsonMap, Line, Music, Result, Short, Shot, Voice } from "./types.ts";
import { fail, ok } from "./types.ts";

export const isMap = (x: unknown): x is JsonMap => typeof x === "object" && x !== null && !Array.isArray(x);
export const isJson = (x: unknown): x is Json =>
  x === null || ["boolean", "number", "string"].includes(typeof x) || (Array.isArray(x) ? x.every(isJson) : isMap(x) && Object.values(x).every(isJson));

const str = (o: JsonMap, k: string): string | undefined => (typeof o[k] === "string" ? String(o[k]) : undefined);
const num = (o: JsonMap, k: string): number | undefined => {
  const v = o[k];
  return typeof v === "number" ? v : undefined;
};
const map = (o: JsonMap, k: string): JsonMap | undefined => {
  const v = o[k];
  return isMap(v) ? v : undefined;
};

const shotOf = (x: Json): Shot | undefined => {
  if (typeof x === "string") return { scene: x };
  if (!isMap(x)) return undefined;
  const scene = str(x, "scene");
  return scene === undefined
    ? undefined
    : { scene, move: str(x, "move"), amount: num(x, "amount"), seed: num(x, "seed"), transition: str(x, "transition") };
};

const shotsOf = (x: Json | undefined): readonly Shot[] | undefined => {
  const list = Array.isArray(x) ? x : x === undefined ? [] : [x];
  const shots = list.map(shotOf);
  return shots.length > 0 && shots.every((s) => s !== undefined) ? shots.filter((s) => s !== undefined) : undefined;
};

const lineOf = (x: Json, i: number): Result<Line> => {
  if (!isMap(x)) return fail(`lines[${i}] is not an object`);
  const say = typeof x.say === "string" || typeof x.say === "number" ? String(x.say) : undefined;
  const shots = shotsOf(x.scene);
  if (say === undefined) return fail(`lines[${i}] has no "say"`);
  if (shots === undefined) return fail(`lines[${i}] needs "scene": a name, {scene, ...}, or a list of them`);
  return ok({
    say, shots, speak: str(x, "speak"), caption: str(x, "caption"), move: str(x, "move"), amount: num(x, "amount"),
    seed: num(x, "seed"), hold: num(x, "hold"), transition: str(x, "transition"),
  });
};

export const DEFAULT_VOICE = { kind: "kokoro", id: "bm_george", speed: 0.92 } satisfies Voice;

const voiceOf = (x: Json | undefined): Voice => {
  if (x === "none") return { kind: "none" };
  if (typeof x === "string") return { ...DEFAULT_VOICE, id: x };
  if (!isMap(x)) return DEFAULT_VOICE;
  const file = str(x, "file");
  if (str(x, "id") === "none") return { kind: "none" };
  if (file !== undefined) return { kind: "file", file };
  return { kind: "kokoro", id: str(x, "id") ?? DEFAULT_VOICE.id, speed: num(x, "speed") ?? DEFAULT_VOICE.speed };
};

const musicOf = (x: Json | undefined): Music =>
  typeof x === "string"
    ? { mood: x }
    : isMap(x)
      ? { mood: str(x, "mood") ?? "tender", volume: num(x, "volume"), seed: num(x, "seed"), start: num(x, "start") }
      : { mood: "tender" };

const collect = <T>(rs: readonly Result<T>[]): Result<readonly T[]> => {
  const errors = rs.flatMap((r) => (r.ok ? [] : r.errors));
  return errors.length ? fail(...errors) : ok(rs.flatMap((r) => (r.ok ? [r.value] : [])));
};

export function parseShort(raw: unknown): Result<Short> {
  if (!isMap(raw)) return fail("short.json is not a JSON object");
  const lines = Array.isArray(raw.lines) ? collect(raw.lines.map(lineOf)) : fail<readonly Line[]>("short.json has no lines");
  if (!lines.ok) return lines;
  if (lines.value.length === 0) return fail("short.json has no lines");
  return ok({
    title: str(raw, "title") ?? "short", format: str(raw, "format") ?? "9:16", fps: num(raw, "fps") || 24,
    twos: num(raw, "twos") || 2, lead: num(raw, "lead") ?? 0.35, pause: num(raw, "pause") ?? 0.3, tail: num(raw, "tail") ?? 1.2,
    transition: str(raw, "transition") ?? "cut", look: raw.look ?? "oil", palette: map(raw, "palette"),
    captions: map(raw, "captions") ?? {}, voice: voiceOf(raw.voice), music: musicOf(raw.music), lines: lines.value,
  });
}
