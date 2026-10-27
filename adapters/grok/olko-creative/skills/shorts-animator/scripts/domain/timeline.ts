// When every shot and caption is on screen. The arithmetic order is load-bearing: renders are compared by hash.
import { captionChunks } from "./captions.ts";
import type { Beat, Cue, Line, Result, Short, Take, Timeline } from "./types.ts";
import { fail, ok } from "./types.ts";

export const FORMATS: Readonly<Record<string, readonly [number, number]>> = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};

type Span = { readonly start: number; readonly speak: number; readonly end: number };

const spanOf = (s: Short, i: number, at: number, take: Take): Span => {
  const line = s.lines[i];
  const speak = at + (i === 0 ? s.lead : 0.05);
  const end = speak + take.dur + s.pause + (line?.hold || 0);
  return { start: at, speak, end: i === s.lines.length - 1 ? end + s.tail : end };
};

/** Each caption chunk starts in proportion to the characters before it, across the spoken part. */
const chunkTimes = (cs: readonly string[], span: Span, take: Take): readonly number[] => {
  const total = cs.reduce((a, c) => a + c.length + 4, 0);
  const before = cs.map((_, j) => cs.slice(0, j).reduce((a, c) => a + (c.length + 4), 0));
  return before.map((acc) => span.speak + (take.dur * acc) / total);
};

const cuesOf = (cs: readonly string[], times: readonly number[], span: Span): readonly Cue[] =>
  cs.map((text, j) => ({ at: j === 0 ? span.start : (times[j] ?? 0), end: j === cs.length - 1 ? span.end : (times[j + 1] ?? 0), text }));

/** Up to as many shots as chunks: cut on a chunk. More shots than chunks: cut evenly through the line. */
const cutsOf = (n: number, times: readonly number[], span: Span): readonly number[] =>
  Array.from({ length: n }, (_, j) =>
    j === 0 ? span.start : n <= times.length ? (times[Math.floor((j * times.length) / n)] ?? 0) : span.speak + ((span.end - span.speak) * j) / n,
  );

const beatsOf = (s: Short, i: number, line: Line, cuts: readonly number[], span: Span): readonly Beat[] =>
  line.shots.map((shot, j) => {
    const bs = cuts[j] ?? span.start;
    const be = j === line.shots.length - 1 ? span.end : (cuts[j + 1] ?? span.end);
    return {
      line: i, scene: shot.scene, start: +bs.toFixed(4), dur: +(be - bs).toFixed(4),
      move: shot.move ?? line.move ?? "push", moveAmount: shot.amount ?? line.amount, seed: shot.seed ?? line.seed,
      transition: j === 0 ? (line.transition ?? s.transition) : (shot.transition ?? "cut"), say: line.say,
    };
  });

type Acc = { readonly t: number; readonly beats: readonly Beat[]; readonly track: readonly Cue[]; readonly voiceAt: readonly number[] };

export function timeline(s: Short, takes: readonly Take[]): Result<Timeline> {
  const size = FORMATS[s.format];
  if (!size) return fail(`format ${s.format}? (${Object.keys(FORMATS).join(", ")})`);
  if (takes.length !== s.lines.length) return fail(`${takes.length} takes for ${s.lines.length} lines`);
  const maxWords = typeof s.captions.words === "number" ? s.captions.words : 5;
  const acc = s.lines.reduce<Acc>(
    (a, line, i) => {
      const take = takes[i] ?? { file: null, dur: 0 };
      const span = spanOf(s, i, a.t, take);
      const cs = captionChunks(line, maxWords);
      const times = chunkTimes(cs, span, take);
      const cuts = cutsOf(line.shots.length, times, span);
      return {
        t: span.end, beats: [...a.beats, ...beatsOf(s, i, line, cuts, span)],
        track: [...a.track, ...cuesOf(cs, times, span)], voiceAt: [...a.voiceAt, span.speak],
      };
    },
    { t: 0, beats: [], track: [], voiceAt: [] },
  );
  const [W, H] = size;
  return ok({
    W, H, fps: s.fps, twos: s.twos, duration: +acc.t.toFixed(3), beats: acc.beats,
    track: s.captions.style === "none" ? [] : acc.track, voiceAt: acc.voiceAt,
  });
}
