import assert from "node:assert/strict";
import { test } from "node:test";
import { captionChunks, chunks, words } from "../domain/captions.ts";
import { check, report, type Facts, type Probe } from "../domain/check.ts";
import { resolveLook } from "../domain/look.ts";
import { parseAssignment, setPath } from "../domain/patch.ts";
import { parseShort } from "../domain/schema.ts";
import { timeline } from "../domain/timeline.ts";
import type { Json, Result, Short, Take, Timeline } from "../domain/types.ts";
import { fail, ok } from "../domain/types.ts";

const value = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
};

const RAW = {
  title: "test", voice: "none", music: "none",
  lines: [
    { say: "A bright and open morning, out on the hills.", scene: "day", move: "push" },
    { say: "Night comes down over the city.", scene: "night" },
  ],
};
const short = (patch: object = {}): Short => value(parseShort({ ...RAW, ...patch }));
const silent = (s: Short): readonly Take[] => s.lines.map(() => ({ file: null, dur: 2 }));
const tl = (s: Short): Timeline => value(timeline(s, silent(s)));

test("words drops the writer's emphasis and pause marks", () => {
  assert.deepEqual(words("a *bright* | morning"), ["a", "bright", "morning"]);
});

test("chunks are balanced, not greedy", () => {
  assert.deepEqual(chunks("one two three four five six seven", 5).map((c) => c.split(" ").length), [4, 3]);
  assert.deepEqual(chunks("short line", 5), ["short line"]);
});

test("a slash in the caption forces the break", () => {
  assert.deepEqual(captionChunks({ say: "Everyone, every pose.", caption: "Everyone, / every pose.", shots: [] }, 5), ["Everyone,", "every pose."]);
});

test("parseShort fills defaults and rejects a script with no lines", () => {
  const s = short();
  assert.equal(s.format, "9:16");
  assert.equal(s.fps, 24);
  assert.equal(s.voice.kind, "none");
  assert.equal(parseShort({ title: "x" }).ok, false);
  assert.equal(parseShort([]).ok, false);
});

test("timeline lays beats end to end and rejects an unknown format", () => {
  const t = tl(short());
  assert.equal(t.beats.length, 2);
  assert.equal(t.W, 1080);
  const [a, b] = t.beats;
  assert.ok(a && b && Math.abs(a.start + a.dur - b.start) < 1e-9);
  assert.ok(t.duration >= b.start + b.dur);
  const bad = timeline(short({ format: "3:2" }), silent(short()));
  assert.equal(bad.ok, false);
});

test("parseAssignment reads JSON values and falls back to text", () => {
  assert.deepEqual(value(parseAssignment("lines.0.hold=0.8")), { path: ["lines", "0", "hold"], value: 0.8 });
  assert.deepEqual(value(parseAssignment("look=watercolor")), { path: ["look"], value: "watercolor" });
  assert.equal(parseAssignment("nokey").ok, false);
  assert.equal(parseAssignment("a..b=1").ok, false);
});

test("setPath returns a new document and leaves the old one alone", () => {
  const doc: Json = { lines: [{ say: "hi" }], music: { mood: "tender" } };
  const before = JSON.stringify(doc);
  const next = setPath(setPath(doc, ["lines", "0", "hold"], 1), ["music", "mood"], "night");
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(next, { lines: [{ say: "hi", hold: 1 }], music: { mood: "night" } });
});

test("resolveLook merges a named base under the overrides", () => {
  const named = (n: string): Result<{ readonly [k: string]: Json }> => (n === "oil" ? ok({ grain: 0.3, edge: 1 }) : fail(`no look "${n}"`));
  const look = value(resolveLook({ base: "oil", grain: 0.5 }, named));
  assert.equal(look.grain, 0.5);
  assert.equal(look.edge, 1);
  assert.equal(resolveLook("nope", named).ok, false);
});

const facts = (probes: readonly Probe[], s = short()): Facts => ({ short: s, timeline: tl(s), probes, kit: ["sky", "person"], lookKeys: ["grain"] });

test("check flags missing scenes, unknown kit calls and throwing scenes as errors", () => {
  const found = check(facts([{ scene: "day", calls: [{ fn: "skyy", opts: {} }] }, { scene: "other", calls: [], error: "boom" }]));
  const errors = found.filter((f) => f.level === "error").map((f) => f.msg);
  assert.ok(errors.some((m) => m.includes('no scene "night"')));
  assert.ok(errors.some((m) => m.includes("k.skyy is not in the kit")));
  assert.ok(errors.some((m) => m.includes("throws: boom")));
});

test("check warns when a person stands in the caption band, unless captions are off", () => {
  const probes: readonly Probe[] = [
    { scene: "day", calls: [{ fn: "person", opts: { y: 0.82, h: 0.28 } }] },
    { scene: "night", calls: [{ fn: "person", opts: { y: 0.5, h: 0.2 } }] },
  ];
  const band = (s: Short) => check(facts(probes, s)).filter((f) => f.msg.includes("caption line"));
  assert.deepEqual(band(short()).map((f) => f.where), ['scene "day"']);
  assert.deepEqual(band(short({ captions: { style: "none" } })), []);
});

test("report is one line per finding, or clean", () => {
  assert.equal(report([]), "check: clean");
  assert.equal(report([{ level: "error", where: "x", msg: "y" }]), "ERROR x: y");
});
