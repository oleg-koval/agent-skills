// The music: presets, chord voicing and the arrangement. Pure given the two rngs; the only effect is
// writing into the buses it allocates itself.
import { SR, biquad, busAdd, busMixFrom, delay, human, makeBus, reverb } from "./dsp.ts";
import type { Bus, Rng, Voice } from "./dsp.ts";
import {
  bass, brush, ep, epChord, hat, kick, outroImpact, outroRiser, pad, pluck, shaker, snare, softSynth, strum, vinyl,
} from "./instruments.ts";

// key = MIDI root; prog = chords as scale degrees in the key, one per bar; ext = chord size (4 = sevenths,
// 5 = ninths). Chords are voiced in the middle register with the root left to the bass.
export type Preset = {
  readonly bpm: number; readonly root: number; readonly scale: readonly number[]; readonly prog: readonly number[];
  readonly ext: number; readonly parts: readonly string[]; readonly swing: number; readonly verb: number;
  readonly duck: number; readonly low?: number; readonly drums?: number;
};
const MAJ: readonly number[] = [0, 2, 4, 5, 7, 9, 11], MIN: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

export const PRESETS: Readonly<Record<string, Preset>> = {
  kinetic: { bpm: 118, root: 57, scale: MIN, prog: [0, 5, 2, 6], ext: 5, parts: ["kick4", "snare", "hatOff", "bassHouse", "epStab", "pad"], swing: 0, verb: 0.2, duck: 0.6 },
  keynote: { bpm: 100, root: 60, scale: MAJ, prog: [0, 5, 3, 4], ext: 4, parts: ["kickHalf", "shaker16", "epPulse", "epHold", "pad", "bassLong"], swing: 0, verb: 0.3, duck: 0.85 },
  aura: { bpm: 78, root: 63, scale: MAJ, prog: [0, 3, 5, 4], ext: 5, parts: ["pad", "epArp", "bassSwell"], swing: 0, verb: 0.45, duck: 1 },
  paper: { bpm: 104, root: 65, scale: MAJ, prog: [0, 4, 5, 3], ext: 4, parts: ["kickSoft", "brush", "hat8", "pluck8", "bassBounce"], swing: 0.14, verb: 0.22, duck: 0.85 },
  terminal: { bpm: 112, root: 62, scale: MIN, prog: [0, 5, 6, 0], ext: 4, parts: ["kick4", "hat16", "bass8", "synthArp", "pad"], swing: 0, verb: 0.2, duck: 0.65, low: 0.7, drums: 0.85 },
  data: { bpm: 86, root: 67, scale: MAJ, prog: [1, 4, 0, 5], ext: 5, parts: ["kickBoom", "snareBoom", "hat8", "epHold", "bassBoom", "vinyl"], swing: 0.18, verb: 0.25, duck: 0.85 },
  story: { bpm: 96, root: 62, scale: MAJ, prog: [0, 4, 5, 3], ext: 4, parts: ["kickSoft", "brush", "shaker8", "guitar8", "epHold", "bassLong"], swing: 0.08, verb: 0.3, duck: 0.9 },
  // Shorts Animator's moods: beds for a voice to sit on, no drums in the quiet ones
  tender: { bpm: 70, root: 60, scale: MAJ, prog: [0, 5, 3, 4], ext: 5, parts: ["pad", "epArp", "bassSwell"], swing: 0, verb: 0.5, duck: 1 },
  hopeful: { bpm: 84, root: 62, scale: MAJ, prog: [0, 4, 5, 3], ext: 4, parts: ["pad", "guitar8", "bassLong"], swing: 0.06, verb: 0.38, duck: 1 },
  night: { bpm: 64, root: 57, scale: MIN, prog: [0, 5, 3, 6], ext: 5, parts: ["pad", "epHold", "bassSwell"], swing: 0, verb: 0.55, duck: 1 },
  wonder: { bpm: 76, root: 65, scale: MAJ, prog: [3, 4, 0, 5], ext: 5, parts: ["pad", "epArp", "bassSwell"], swing: 0, verb: 0.5, duck: 1 },
  playful: { bpm: 100, root: 65, scale: MAJ, prog: [0, 4, 5, 3], ext: 4, parts: ["kickSoft", "brush", "pluck8", "bassBounce"], swing: 0.14, verb: 0.22, duck: 0.9 },
};

// ---------- harmony ----------
const chord = (root: number, scale: readonly number[], deg: number, size = 4): number[] =>
  Array.from({ length: size }, (_, k) => { const s = deg + k * 2; return root + scale[s % 7] + 12 * Math.floor(s / 7); });
const bassNote = (root: number, scale: readonly number[], deg: number): number => {
  let m = root + scale[deg % 7];
  while (m > 45) m -= 12;
  while (m < 33) m += 12;
  return m;
};
function nextWithPc(from: number, pc: number): number {
  let m = from + 1;
  while (m % 12 !== pc) m++;
  return m;
}
// rootless close voicing that tops out by B4, as near as it can to the last chord's lowest note
function voicing(root: number, scale: readonly number[], deg: number, size: number, prev: readonly number[] | null): number[] {
  const tones = chord(root, scale, deg, size).map((m) => ((m % 12) + 12) % 12);
  const pcs = size >= 4 ? tones.slice(1) : tones;
  const want = prev ? (prev[0] + 56) / 2 : 56; // led by the last chord, pulled back toward the middle
  const cands = Array.from({ length: 14 }, (_, i) => 51 + i).filter((lo) => lo % 12 === pcs[0]).map((lo) => {
    const v = pcs.slice(1).reduce((acc, pc) => [...acc, nextWithPc(acc[acc.length - 1], pc)], [lo]);
    return { v, score: Math.abs(lo - want) + (v[v.length - 1] > 71 ? 100 : 0) };
  });
  return cands.reduce((best, c) => (c.score < best.score ? c : best)).v;
}

// ---------- the arrangement ----------
export type Timing = { readonly duration: number; readonly outroAt?: number };
type Ctx = {
  readonly P: Preset; readonly r: Rng; readonly ham: Rng;
  readonly spb: number; readonly bar: number; readonly s16: number; readonly end: number;
  readonly drums: Bus; readonly inst: Bus; readonly low: Bus; readonly send: Bus;
  readonly voices: readonly (readonly number[])[]; readonly roots: readonly number[];
};
type Bar = { readonly b: number; readonly t0: number; readonly ch: readonly number[]; readonly rt: number; readonly len: number };

const hasPart = (c: Ctx, p: string): boolean => c.P.parts.includes(p);
const intro = (c: Ctx, bar: Bar): boolean => bar.b === 0 && c.P.bpm < 90; // slow beds open on the harmony alone
const before = (c: Ctx, t: number): boolean => t < c.end - 0.02;
// every call draws one rng value for the humanising jitter, so the call order is part of the sound
function at(c: Ctx, bar: Bar, q: number): number {
  const swing = q % 2 ? c.P.swing * c.s16 * 2 : 0;
  return bar.t0 + q * c.s16 + swing + (c.r() - 0.5) * 0.01;
}
const steps = (step: number, count = 16 / step): number[] => Array.from({ length: count }, (_, i) => i * step);

// stops at the first step that falls past the end
function walk(c: Ctx, bar: Bar, qs: readonly number[], fn: (q: number, t: number) => void): void {
  for (const q of qs) {
    const t = Math.max(0, at(c, bar, q));
    if (!before(c, t)) break;
    fn(q, t);
  }
}
// skips the steps that fall past the end, keeps going
function visit(c: Ctx, bar: Bar, qs: readonly number[], clampT: boolean, fn: (q: number, t: number) => void): void {
  for (const q of qs) {
    const raw = at(c, bar, q), t = clampT ? Math.max(0, raw) : raw;
    if (before(c, t)) fn(q, t);
  }
}
const instSend = (c: Ctx, v: Voice, t: number, ig: number, pan: number, sg: number): void => {
  busAdd(c.inst, v, t, ig, pan);
  busAdd(c.send, v, t, sg);
};

// ---------- drums: each step returns the kick times it played (the sidechain listens to them) ----------
type DrumStep = (c: Ctx, bar: Bar, q: number, t: number) => number[];
const kickAt = (c: Ctx, t: number, v: Float32Array, gain: number): number[] => { busAdd(c.drums, v, t, gain); return [t]; };
const snareAt = (c: Ctx, t: number, s: Float32Array, dg: number, sg: number): number[] => { busAdd(c.drums, s, t, dg); busAdd(c.send, s, t, sg); return []; };
const tick = (c: Ctx, v: Float32Array, t: number, gain: number, pan: number): number[] => { busAdd(c.drums, v, t, gain, pan); return []; };

// the order is the order the rng is drawn in
const DRUM_STEPS: readonly (readonly [string, DrumStep])[] = [
  ["kick4", (c, _b, q, t) => (q % 4 === 0 ? kickAt(c, t, kick(c.r), 0.75 * human(c.r, 0.08)) : [])],
  ["kickHalf", (c, _b, q, t) => (q === 0 || q === 8 ? kickAt(c, t, kick(c.r, { punch: 0.6, dec: 0.32 }), 0.45) : [])],
  ["kickSoft", (c, bar, q, t) => (q === 0 || q === 8 || (q === 6 && bar.b % 2 === 1) ? kickAt(c, t, kick(c.r, { punch: 0.7, dec: 0.3 }), 0.55) : [])],
  ["kickBoom", (c, _b, q, t) => (q === 0 || q === 7 || q === 10 ? kickAt(c, t, kick(c.r, { pitch: 48, dec: 0.4 }), q === 7 ? 0.4 : 0.65) : [])],
  ["snare", (c, _b, q, t) => (q === 4 || q === 12 ? snareAt(c, t, snare(c.r, { tone: 200, top: 8000 }), 0.42, 0.18) : [])],
  ["snareBoom", (c, _b, q, t) => (q === 4 || q === 12 ? snareAt(c, t, snare(c.r, { dec: 0.16, top: 6000 }), 0.5, 0.12) : [])],
  ["brush", (c, _b, q, t) => {
    if (q !== 4 && q !== 12) return [];
    const s = brush(c.r);
    busAdd(c.drums, s, t, 0.5, 0.1); busAdd(c.send, s, t, 0.2);
    return [];
  }],
  ["hatOff", (c, _b, q, t) => (q % 4 === 2 ? tick(c, hat(c.r), t, 0.3 * human(c.r, 0.3), 0.25) : [])],
  ["hat8", (c, _b, q, t) => (q % 2 === 0 ? tick(c, hat(c.r), t, (q % 4 === 2 ? 0.2 : 0.11) * human(c.r, 0.4), 0.3) : [])],
  ["shaker16", (c, _b, q, t) => tick(c, shaker(c.r), t, (q % 4 === 2 ? 0.2 : q % 2 ? 0.07 : 0.12) * human(c.r, 0.4), 0.35)],
  ["shaker8", (c, _b, q, t) => (q % 2 === 0 ? tick(c, shaker(c.r), t, (q % 4 === 2 ? 0.2 : 0.1) * human(c.r, 0.4), 0.35) : [])],
  ["hat16", (c, _b, q, t) => tick(c, hat(c.r), t, (q % 4 === 2 ? 0.16 : 0.08) * human(c.r, 0.4), -0.2)],
];

// recursion (not a loop) so the kick times come back as a value; stops at the first step past the end
function drumWalk(c: Ctx, bar: Bar, q: number): number[] {
  if (q >= 16) return [];
  const t = Math.max(0, at(c, bar, q));
  if (!before(c, t)) return [];
  const here = DRUM_STEPS.flatMap(([name, fn]) => (hasPart(c, name) ? fn(c, bar, q, t) : []));
  return [...here, ...drumWalk(c, bar, q + 1)];
}

// ---------- harmony and bass parts ----------
type Part = (c: Ctx, bar: Bar) => void;

const padPart: Part = (c, bar) => {
  const p = pad(bar.ch, bar.len + 1.2, c.r, { cutoff: c.P.bpm < 90 ? 2800 : 2400, attack: intro(c, bar) ? 1.4 : 0.5 });
  instSend(c, p, bar.t0, hasPart(c, "epArp") ? 0.5 : 0.28, 0, 0.4);
};
const epHoldPart: Part = (c, bar) => visit(c, bar, bar.b % 2 ? [0, 10] : [0], false, (q, t) => {
  const v = epChord(bar.ch, q ? c.spb * 1.5 : bar.len + 0.3, 0.42, c.r, c.ham);
  instSend(c, v, Math.max(0, t), q ? 0.3 : 0.45, 0, 0.3);
});
const epStabPart: Part = (c, bar) => {
  if (intro(c, bar)) return;
  visit(c, bar, [3, 6, 10, 14], false, (q, t) => instSend(c, epChord(bar.ch, c.spb * 0.55, 0.5, c.r, c.ham, { roll: 0.004 }), t, 0.5, q % 2 ? 0.15 : -0.15, 0.25));
};
const epPulsePart: Part = (c, bar) => walk(c, bar, steps(2), (q, t) => {
  const m = q % 8 === 0 ? bar.ch[0] : q % 4 === 0 ? bar.ch[2] ?? bar.ch[1] : bar.ch[1];
  const v = ep(m - 12 >= 48 ? m - 12 : m, c.spb * 0.9, 0.38 * human(c.r, 0.15), c.ham);
  instSend(c, v, t, 0.38, q % 4 ? 0.2 : -0.2, 0.25);
});
const epArpPart: Part = (c, bar) => walk(c, bar, steps(4), (q, t) => {
  const v = ep(bar.ch[(q / 4) % bar.ch.length], c.spb * 3, 0.3 * human(c.r, 0.2), c.ham);
  instSend(c, v, t, 0.42, (q / 4 - 1.5) * 0.3, 0.5);
});
const PLUCK8_PAT = [0, 2, 1, 3, 2, 1, 0, 2];
const pluck8Part: Part = (c, bar) => {
  if (intro(c, bar)) return;
  // steps 3 and 7 are rests: they draw no jitter and cannot end the walk
  walk(c, bar, [0, 1, 2, 4, 5, 6].map((k) => k * 2), (q, t) => {
    const k = q / 2, s = pluck(bar.ch[PLUCK8_PAT[k] % bar.ch.length], 0.8, c.r, { bright: 0.28, decay: 0.993 });
    instSend(c, s, t, human(c.r, 0.2), (k % 3 - 1) * 0.3, 0.3);
  });
};
const GUITAR8_PAT = [0, 1, 2, 3, 2, 1, 2, 3];
const guitar8Part: Part = (c, bar) => walk(c, bar, steps(2), (q, t) => {
  const k = q / 2, ch = bar.ch;
  const m = k === 0 ? (ch[0] - 12 >= 45 ? ch[0] - 12 : ch[0]) : ch[GUITAR8_PAT[k] % ch.length];
  const s = pluck(m, 1.2, c.r, { bright: 0.22, decay: 0.996 });
  instSend(c, s, t, 0.9 * human(c.r, 0.2), k % 2 ? 0.25 : -0.25, 0.3);
});
const SYNTH_ARP_PAT = [0, 1, 2, 1, 3, 2];
const synthArpPart: Part = (c, bar) => {
  if (intro(c, bar)) return;
  walk(c, bar, steps(1), (q, t) => {
    const m = bar.ch[SYNTH_ARP_PAT[q % 6] % bar.ch.length] - 12;
    const s = softSynth(m < 45 ? m + 12 : m, c.s16 * 1.6, 1900 + 700 * Math.sin((bar.b * 16 + q) / 10));
    instSend(c, s, t, 0.22, q % 2 ? 0.25 : -0.25, 0.22);
  });
};

const lowAt = (c: Ctx, v: Float32Array, t: number, gain: number): void => busAdd(c.low, v, t, gain);
const bassHousePart: Part = (c, bar) => {
  if (intro(c, bar)) return;
  visit(c, bar, [2, 6, 10, 14], false, (q, t) => lowAt(c, bass(q === 14 ? bar.rt + 7 : bar.rt, c.spb * 0.45), t, 0.55));
};
const bassLongPart: Part = (c, bar) => visit(c, bar, [0, 8], true, (_q, t) => lowAt(c, bass(bar.rt, c.spb * 1.9, { a: 0.02, r: 0.2 }), t, 0.45));
const bassSwellPart: Part = (c, bar) => lowAt(c, bass(bar.rt, bar.len + 0.4, { a: 0.6, r: 0.6, drive: 1 }), bar.t0, 0.4);
const BOUNCE: readonly (readonly [number, number])[] = [[0, 0], [6, 7], [8, 0], [14, 7]];
const bassBouncePart: Part = (c, bar) => {
  if (intro(c, bar)) return;
  BOUNCE.forEach(([q, d]) => visit(c, bar, [q], true, (_q, t) => lowAt(c, bass(bar.rt + d, c.spb * 0.45, { tone: 0.3 }), t, 0.5)));
};
const bass8Part: Part = (c, bar) => {
  if (intro(c, bar)) return;
  visit(c, bar, steps(2), true, (_q, t) => lowAt(c, bass(bar.rt, c.spb * 0.4), t, 0.34));
};
const bassBoomPart: Part = (c, bar) => visit(c, bar, [0, 10], true, (q, t) => lowAt(c, bass(bar.rt, c.spb * (q ? 1.2 : 1.5), { a: 0.01, r: 0.15 }), t, 0.55));

// the order is the order the rng is drawn in: harmony first, then bass
const PARTS: readonly (readonly [string, Part])[] = [
  ["pad", padPart], ["epHold", epHoldPart], ["epStab", epStabPart], ["epPulse", epPulsePart], ["epArp", epArpPart],
  ["pluck8", pluck8Part], ["guitar8", guitar8Part], ["synthArp", synthArpPart],
  ["bassHouse", bassHousePart], ["bassLong", bassLongPart], ["bassSwell", bassSwellPart],
  ["bassBounce", bassBouncePart], ["bass8", bass8Part], ["bassBoom", bassBoomPart],
];

function renderBar(c: Ctx, bar: Bar): number[] {
  const kicks = intro(c, bar) ? [] : drumWalk(c, bar, 0);
  PARTS.forEach(([name, part]) => { if (hasPart(c, name)) part(c, bar); });
  return kicks;
}

// the end: a low swell, one deep hit, the home chord left ringing
function ending(c: Ctx, duration: number): void {
  const { P, r, ham, spb, end } = c;
  const home = voicing(P.root, P.scale, 0, P.ext || 4, c.voices[c.voices.length - 1]);
  const riserSec = Math.min(1.6, spb * 3);
  busAdd(c.inst, outroRiser(r, riserSec), end - riserSec, 0.14);
  const hit = outroImpact(r, P.root);
  busAdd(c.inst, hit, end, 0.3); busAdd(c.send, hit, end, 0.2);
  const tail = Math.max(2.4, duration - end + 1.8);
  if (hasPart(c, "guitar8") || hasPart(c, "pluck8")) {
    const s = strum([bassNote(P.root, P.scale, 0) + 12, ...home], tail, r, { bright: 0.24, decay: 0.998 });
    busAdd(c.inst, s, end, 1.1); busAdd(c.send, s, end, 0.4);
  } else {
    const ch = epChord(home, tail, 0.45, r, ham, { roll: 0.03 });
    busAdd(c.inst, ch, end, 0.55); busAdd(c.send, ch, end, 0.5);
  }
  const p = pad(home, tail, r, { cutoff: 2200, attack: 0.05, release: 1.8 });
  busAdd(c.inst, p, end, 0.22); busAdd(c.send, p, end, 0.4);
  busAdd(c.low, bass(bassNote(P.root, P.scale, 0), Math.max(1.5, duration - end + 0.6), { a: 0.005, r: 1.2 }), end, 0.45);
  if (P.parts.some((x) => x.startsWith("kick"))) busAdd(c.drums, kick(r, { dec: 0.5 }), end, 0.7);
}

// ---------- mix ----------
function duckAround(duck: Float32Array, t: number, depth: number): void {
  const i0 = Math.round(t * SR);
  for (let i = 0; i < 0.22 * SR && i0 + i < duck.length; i++) duck[i0 + i] = Math.min(duck[i0 + i], 1 - depth + depth * Math.pow(i / (0.22 * SR), 0.6));
}
// sidechain: the harmony breathes under each kick (deep for the dance beds, barely for the gentle ones)
function sidechain(c: Ctx, kicks: readonly number[]): void {
  const depth = 1 - c.P.duck;
  if (depth <= 0.01) return;
  const { inst, low } = c, duck = new Float32Array(inst.n).fill(1);
  kicks.forEach((t) => duckAround(duck, t, depth));
  for (let i = 0; i < inst.n; i++) { inst.L[i] *= duck[i]; inst.R[i] *= duck[i]; low.L[i] *= duck[i] * 0.7 + 0.3; low.R[i] *= duck[i] * 0.7 + 0.3; }
}
// a dark room: the reverb only hears the middle of the spectrum
function darken(send: Bus): void {
  const sl = [biquad("lp", 6500), biquad("lp", 6500)], sh = [biquad("hp", 220), biquad("hp", 220)];
  for (let i = 0; i < send.n; i++) { send.L[i] = sl[0](sh[0](send.L[i])); send.R[i] = sl[1](sh[1](send.R[i])); }
}
function mixDown(c: Ctx, total: number, duration: number): Bus {
  const { P, send, spb } = c;
  darken(send);
  const wet = reverb(send, { room: P.verb > 0.4 ? 0.88 : 0.82, damp: 0.45 });
  const echo = P.bpm >= 100 ? delay(send, spb * 0.75, 0.28, 2400) : null;
  const music = makeBus(total);
  busMixFrom(music, c.drums, P.drums ?? 1); busMixFrom(music, c.inst, 1); busMixFrom(music, c.low, P.low ?? 1); busMixFrom(music, wet, P.verb * 2.2);
  if (echo) busMixFrom(music, echo, 0.1);
  // fade in over half a beat, out after the ring
  const fin = Math.round(spb * SR * 0.5), fout0 = Math.round((duration + 0.2) * SR), fout1 = Math.round((duration + 2.6) * SR);
  for (let i = 0; i < music.n; i++) {
    const g = (i < fin ? i / fin : 1) * (i > fout0 ? Math.max(0, 1 - (i - fout0) / (fout1 - fout0)) : 1);
    music.L[i] *= g; music.R[i] *= g;
  }
  return music;
}

export function composeMusic(P: Preset, timing: Timing, r: Rng, ham: Rng): Bus {
  const { duration } = timing;
  const spb = 60 / P.bpm, bar = spb * 4, total = duration + 3; // ring-out
  const end = timing.outroAt ?? Math.max(0, duration - 3);
  const nBars = Math.ceil(duration / bar) + 1;
  const deg = (b: number): number => P.prog[b % P.prog.length];
  const voices = Array.from({ length: nBars }).reduce<number[][]>((acc, _, b) => [...acc, voicing(P.root, P.scale, deg(b), P.ext || 4, acc[b - 1] ?? null)], []);
  const roots = Array.from({ length: nBars }, (_, b) => bassNote(P.root, P.scale, deg(b)));
  const c: Ctx = { P, r, ham, spb, bar, s16: spb / 4, end, drums: makeBus(total), inst: makeBus(total), low: makeBus(total), send: makeBus(total), voices, roots };
  const bars = Array.from({ length: nBars }, (_, b) => b).filter((b) => b * bar < end - 0.01);
  const kicks = bars.flatMap((b) => renderBar(c, { b, t0: b * bar, ch: voices[b], rt: roots[b], len: Math.min(bar, end - b * bar) }));
  if (hasPart(c, "vinyl")) busAdd(c.inst, vinyl(duration + 1, r), 0, 0.5);
  ending(c, duration);
  sidechain(c, kicks);
  return mixDown(c, total, duration);
}
