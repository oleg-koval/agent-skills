// Voiced to sound played, not like a ringtone: electric piano, felt plucks, warm pads, a round sub and
// soft drums, all in the low and middle register. Nothing melodic sits above about B4, no bare sine or
// square plays up high, and every source is low-passed before it reaches the mix.
import {
  SR, TAU, addInto, adsr, biquad, expDecay, filt, human, mtof, mulInto, noise, osc, scaleBy, tabulate,
} from "./dsp.ts";
import type { Rng, Stereo } from "./dsp.ts";

// ---------- drums ----------
type KickOpts = { pitch?: number; dec?: number; punch?: number };

function kickBody(n: number, pitch: number, dec: number, punch: number): Float32Array {
  const o = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += pitch * (1 + 1.1 * punch * Math.exp(-t / 0.035)) / SR;
    o[i] = Math.sin(TAU * ph) * Math.exp(-t / (dec * 0.45)) * Math.min(1, i / 48);
  }
  return o;
}
// round kick: a short sweep down to the fundamental, a felt click, a little saturation
export function kick(r: Rng, { pitch = 50, dec = 0.36, punch = 1 }: KickOpts = {}): Float32Array {
  const sec = dec + 0.12, n = Math.ceil(sec * SR), o = kickBody(n, pitch, dec, punch);
  const click = filt(mulInto(noise(0.01, r), expDecay(0.01, 0.002)), biquad("lp", 1400));
  addInto(o, click, 0, (x) => x * 0.18 * punch);
  for (let i = 0; i < n; i++) o[i] = Math.tanh(o[i] * 1.3) / Math.tanh(1.3);
  return o;
}

type SnareOpts = { tone?: number; dec?: number; top?: number };
// a soft, dusty snare: a short tuned body and a band of noise with the top rolled off
export function snare(r: Rng, { tone = 190, dec = 0.14, top = 7000 }: SnareOpts = {}): Float32Array {
  const sec = dec * 3, n = Math.ceil(sec * SR), o = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += tone * (1 + 0.25 * Math.exp(-t / 0.01)) / SR; o[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.045) * 0.7; }
  const nz = filt(mulInto(noise(sec, r, true), expDecay(sec, dec * 0.6)), biquad("bp", 1700, 0.6), biquad("lp", top), biquad("hp", 300));
  return tabulate(n, (i) => (o[i] + nz[i] * 3.2) * Math.min(1, i / 72));
}
// brush: a slow-onset sweep of noise, no crack
export function brush(r: Rng): Float32Array {
  const o = filt(noise(0.28, r, true), biquad("bp", 2200, 0.5), biquad("lp", 7000), biquad("hp", 450));
  return scaleBy(o, (i) => { const t = i / SR; return Math.min(1, t / 0.018) * Math.exp(-t / 0.09) * 2.4; });
}
// a closed hat with the fizz taken off (nothing above ~9 kHz)
export function hat(r: Rng): Float32Array {
  const o = filt(noise(0.07, r), biquad("hp", 5600, 0.7), biquad("lp", 11000));
  return scaleBy(o, (i) => { const t = i / SR; return Math.min(1, i / 96) * Math.exp(-t / 0.018); });
}
// shaker: a short grain of high noise with a soft onset (the light percussion of a calm bed)
export function shaker(r: Rng): Float32Array {
  const o = filt(noise(0.09, r), biquad("bp", 4200, 1.1), biquad("lp", 9000));
  return scaleBy(o, (i) => { const t = i / SR; return Math.min(1, t / 0.008) * Math.exp(-t / 0.03) * 1.6; });
}
function crackle(o: Float32Array, i: number, r: Rng): void {
  const a = (r() * 0.6 + 0.2) * (r() < 0.5 ? -1 : 1);
  for (let k = 0; k < 30 && i + k < o.length; k++) o[i + k] += a * Math.exp(-k / 6);
}
// vinyl: sparse soft crackle and a little low hiss (the lofi bed's air)
export function vinyl(sec: number, r: Rng): Float32Array {
  const n = Math.ceil(sec * SR), o = new Float32Array(n);
  for (let i = 0; i < n; i++) if (r() < 0.00035) crackle(o, i, r);
  addInto(o, noise(sec, r, true), 0, (x) => x * 0.05);
  return filt(o, biquad("lp", 3200), biquad("hp", 250));
}

// ---------- bass and keys ----------
type BassOpts = { a?: number; r?: number; drive?: number; tone?: number };
// sub bass: a sine with a touch of its own second harmonic, so it still reads on a phone speaker
export function bass(note: number, sec: number, { a = 0.006, r = 0.08, drive = 1.3, tone = 0.18 }: BassOpts = {}): Float32Array {
  const f = mtof(note), n = Math.ceil(sec * SR), env = adsr(sec, a, 0.18, 0.75, r);
  const o = tabulate(n, (i) => {
    const t = i / SR, x = Math.sin(TAU * f * t) + tone * Math.sin(TAU * 2 * f * t + 0.6);
    return Math.tanh(x * drive) / Math.tanh(drive) * env[i];
  });
  return filt(o, biquad("lp", 520));
}

// electric piano (FM, Rhodes-like): a 1:1 pair for the body and the bark of a harder hit, the tine
// short and quiet, rounder the softer it's played; low notes ring longer. `rh` feeds the hammer noise.
export function ep(note: number, sec: number, vel: number, rh: Rng): Float32Array {
  const f = mtof(note), n = Math.ceil(sec * SR);
  const ham = scaleBy(filt(mulInto(noise(0.03, rh), expDecay(0.03, 0.006)), biquad("bp", 2600, 0.7)), () => 1.6 * vel);
  const idx = 0.5 + 1.7 * vel, tau = 0.7 + 1.8 * Math.exp(-(note - 48) / 16), rel = Math.min(n, Math.round(0.09 * SR));
  const o = tabulate(n, (i) => {
    const t = i / SR, I = idx * Math.exp(-t / 0.25) + 0.15;
    const body = Math.sin(TAU * f * t + I * Math.sin(TAU * f * t));
    const tine = Math.sin(TAU * f * 4 * t) * Math.exp(-t / 0.025) * 0.12 * vel + (ham[i] || 0);
    const e = Math.min(1, i / (0.003 * SR)) * Math.exp(-t / tau);
    return (body + tine) * (i > n - rel ? e * ((n - i) / rel) : e) * (0.55 + 0.45 * vel);
  });
  return filt(o, biquad("lp", 2200 + 3000 * vel, 0.6), biquad("hp", 70));
}
type ChordOpts = { roll?: number; trem?: number };
// a chord on the electric piano: slightly rolled, with a slow stereo tremolo
export function epChord(notes: readonly number[], sec: number, vel: number, r: Rng, rh: Rng, { roll = 0.012, trem = 0.18 }: ChordOpts = {}): Stereo {
  const n = Math.ceil((sec + roll * notes.length) * SR), L = new Float32Array(n), R = new Float32Array(n);
  const share = (x: number) => x / notes.length * 1.8;
  notes.forEach((m, k) => {
    const v = ep(m, sec, vel * human(r, 0.16), rh), off = Math.round(k * roll * SR * human(r, 0.6));
    addInto(L, v, off, share); addInto(R, v, off, share);
  });
  const ph = r() * TAU;
  for (let i = 0; i < n; i++) { const p = trem * Math.sin(TAU * 4.6 * i / SR + ph); L[i] *= 1 - p; R[i] *= 1 + p; }
  return { L, R };
}

// ---------- plucks, pads, synth ----------
type PluckOpts = { bright?: number; decay?: number };
// felt pluck (Karplus-Strong, dark): muted guitar, kalimba or felt piano, with a warm body under it
export function pluck(note: number, sec: number, r: Rng, { bright = 0.25, decay = 0.995 }: PluckOpts = {}): Float32Array {
  const f = mtof(note), p = Math.max(2, Math.round(SR / f)), n = Math.ceil(sec * SR), o = new Float32Array(n);
  const buf = new Float32Array(p);
  for (let i = 0; i < p; i++) buf[i] = r() * 2 - 1;
  const pre = biquad("lp", 500 + bright * 3000);
  filt(buf, pre, pre);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const j = i % p, v = buf[j];
    buf[j] = (v + last) * 0.5 * decay;
    last = v; o[i] = v;
  }
  for (let i = 0; i < n; i++) o[i] += Math.sin(TAU * f * i / SR) * Math.exp(-i / SR / 0.25) * 0.25;
  return filt(mulInto(o, adsr(sec, 0.003, 0.05, 1, 0.1)), biquad("hp", 90), biquad("lp", 5200));
}
// a strummed chord on the felt pluck (the guitar's ending)
export function strum(notes: readonly number[], sec: number, r: Rng, o: PluckOpts = {}): Float32Array {
  const n = Math.ceil((sec + 0.2) * SR), out = new Float32Array(n);
  notes.forEach((m, k) => addInto(out, pluck(m, sec, r, o), Math.round(k * 0.028 * SR), (x) => x * 0.55));
  return out;
}

type PadOpts = { cutoff?: number; attack?: number; release?: number; detune?: number };
// the saws, detuned across a note's four voices and split left/right, summed before filtering
function padSaws(notes: readonly number[], sec: number, r: Rng, detune: number): Stereo {
  const n = Math.ceil(sec * SR), L = new Float32Array(n), R = new Float32Array(n);
  for (const m of notes) {
    for (let k = 0; k < 4; k++) addInto(k % 2 ? R : L, osc("saw", mtof(m + (k - 1.5) * detune / 1.5), sec, r()), 0, (x) => x * 0.16);
  }
  return { L, R };
}
// a warm pad: detuned saws through a steep low-pass, a sine an octave under, slow in and out, stereo
export function pad(notes: readonly number[], sec: number, r: Rng, { cutoff = 2600, attack = 0.8, release = 1.4, detune = 0.07 }: PadOpts = {}): Stereo {
  const { L, R } = padSaws(notes, sec, r, detune), n = L.length;
  const lo = osc("sine", mtof(notes[0] - 12), sec);
  const env = adsr(sec, attack, 0.5, 0.85, release);
  const f = [biquad("lp", cutoff, 0.55), biquad("lp", cutoff, 0.55), biquad("lp", cutoff * 1.1, 0.55), biquad("lp", cutoff * 1.1, 0.55)];
  const h = [biquad("hp", 110), biquad("hp", 110)];
  const g = 2.2 / notes.length;
  const air = filt(noise(sec, r, true), biquad("bp", 3800, 0.6), biquad("lp", 9000));
  for (let i = 0; i < n; i++) {
    L[i] = (h[0](f[2](f[0](L[i]))) * g + lo[i] * 0.12 + air[i] * 0.1) * env[i];
    R[i] = (h[1](f[3](f[1](R[i]))) * g + lo[i] * 0.12 - air[i] * 0.1) * env[i];
  }
  return { L, R };
}
// a soft, low synth note (Terminal's arpeggio): a saw through a low filter
export function softSynth(note: number, sec: number, cut = 1800): Float32Array {
  const o = osc("saw", mtof(note), sec), f = biquad("lp", cut, 0.7);
  for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] = f(o[i]) * Math.min(1, i / 120) * Math.exp(-t / (sec * 0.6)); }
  return o;
}

// ---------- the ending ----------
// a low, dark swell that grows into its end (a hiss climbing to the sky is what sounds cheap)
export function outroRiser(r: Rng, sec: number): Stereo {
  const n = Math.ceil(sec * SR), L = new Float32Array(n), R = new Float32Array(n);
  const src = noise(sec, r, true), bl = biquad("bp", 140, 0.8), br = biquad("bp", 140, 0.8), ll = biquad("lp", 2200), lr = biquad("lp", 2200);
  const fo = Math.round(0.04 * SR);
  for (let i = 0; i < n; i++) {
    const k = i / n, f = 140 * Math.pow(1600 / 140, k * k);
    if (i % 32 === 0) { bl.set(f, 0.8); br.set(f * 1.04, 0.8); }
    const env = Math.pow(k, 2.2) * (i > n - fo ? (n - i) / fo : 1) * 2.6;
    L[i] = ll(bl(src[i])) * env; R[i] = lr(br(src[i])) * env;
  }
  return { L, R };
}
// one deep hit with a breath of air after it
export function outroImpact(r: Rng, note: number): Stereo {
  const n = Math.ceil(2.4 * SR), L = new Float32Array(n), R = new Float32Array(n);
  const boom = filt(kick(r, { pitch: mtof(note - 24) * 0.9, punch: 0.4, dec: 1.4 }), biquad("lp", 700));
  const air = filt(mulInto(noise(1.3, r, true), expDecay(1.3, 0.3)), biquad("lp", 1100), biquad("hp", 90));
  for (let i = 0; i < n; i++) { const b = boom[i] || 0, a = air[i] || 0; L[i] = b * 0.9 + a * 0.45; R[i] = b * 0.9 + a * 0.4; }
  return { L, R };
}
