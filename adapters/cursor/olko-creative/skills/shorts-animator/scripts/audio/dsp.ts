// DSP kit: rng, filters, oscillators, envelopes, noise, reverb, delay, mixing.
// The only state is a typed array a function allocates (or is handed as its output buffer), plus a filter's
// own memory and a seeded rng closure.
export const SR = 48000;
export const TAU = Math.PI * 2;

export type Rng = () => number;
export type Stereo = { readonly L: Float32Array; readonly R: Float32Array };
export type Bus = Stereo & { readonly n: number };
export type Voice = Float32Array | Stereo;

export const rng = (seed: number): Rng => {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};
export const human = (r: Rng, amt = 0.1): number => 1 - amt / 2 + r() * amt;
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

// ---------- buses and mixing ----------
export function makeBus(sec: number): Bus {
  const n = Math.ceil(sec * SR);
  return { L: new Float32Array(n), R: new Float32Array(n), n };
}
const isStereo = (v: Voice): v is Stereo => !(v instanceof Float32Array);

// mix a mono or stereo voice in at time `at` (seconds), equal-power pan -1..1
export function busAdd(bus: Bus, v: Voice, at: number, gain = 1, pan = 0): void {
  const i0 = Math.round(at * SR);
  const pl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, pr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  const vl = isStereo(v) ? v.L : v, vr = isStereo(v) ? v.R : v;
  for (let i = 0; i < vl.length; i++) {
    const j = i0 + i;
    if (j < 0) continue;
    if (j >= bus.n) break;
    bus.L[j] += vl[i] * gain * pl;
    bus.R[j] += vr[i] * gain * pr;
  }
}
export function busMixFrom(dst: Bus, b: Bus, gain = 1): void {
  for (let i = 0; i < dst.n && i < b.n; i++) { dst.L[i] += b.L[i] * gain; dst.R[i] += b.R[i] * gain; }
}
export function busGain(bus: Bus, k: number): void {
  for (let i = 0; i < bus.n; i++) { bus.L[i] *= k; bus.R[i] *= k; }
}

// ---------- typed-array helpers ----------
export const tabulate = (n: number, f: (i: number) => number): Float32Array => Float32Array.from({ length: n }, (_, i) => f(i));
export function addInto(dst: Float32Array, src: Float32Array, off: number, f: (x: number) => number): void {
  for (let i = 0; i < src.length && i + off < dst.length; i++) dst[i + off] += f(src[i]);
}
export function scaleBy(a: Float32Array, g: (i: number) => number): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] *= g(i);
  return a;
}
export function mulInto(a: Float32Array, b: Float32Array): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] *= b[i] ?? 0;
  return a;
}

// ---------- RBJ biquad ----------
export type FilterType = "lp" | "hp" | "bp" | "lowshelf" | "highshelf";
type Coefs = readonly [number, number, number, number, number, number];
type Terms = { readonly cs: number; readonly a: number; readonly A: number };

const shelf = (sg: number) => ({ cs, a, A }: Terms): Coefs => {
  const s = Math.sqrt(A) * 2 * a;
  return [
    A * ((A + 1) - sg * (A - 1) * cs + s), 2 * sg * A * ((A - 1) - sg * (A + 1) * cs), A * ((A + 1) - sg * (A - 1) * cs - s),
    (A + 1) + sg * (A - 1) * cs + s, -2 * sg * ((A - 1) + sg * (A + 1) * cs), (A + 1) + sg * (A - 1) * cs - s,
  ];
};
const COEF: Record<FilterType, (t: Terms) => Coefs> = {
  lp: ({ cs, a }) => { const b0 = (1 - cs) / 2; return [b0, 1 - cs, b0, 1 + a, -2 * cs, 1 - a]; },
  hp: ({ cs, a }) => { const b0 = (1 + cs) / 2; return [b0, -(1 + cs), b0, 1 + a, -2 * cs, 1 - a]; },
  bp: ({ cs, a }) => [a, 0, -a, 1 + a, -2 * cs, 1 - a],
  lowshelf: shelf(1),
  highshelf: shelf(-1),
};
function coef(type: FilterType, f: number, q: number, db: number): readonly [number, number, number, number, number] {
  const w = TAU * clamp(f, 10, SR / 2.2) / SR, cs = Math.cos(w), sn = Math.sin(w);
  const [b0, b1, b2, a0, a1, a2] = COEF[type]({ cs, a: sn / (2 * q), A: Math.pow(10, db / 40) });
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
export type Filter = (x: number) => number;
export type Biquad = Filter & { set(f: number, q?: number): void };

// the filter's own memory is a closure; `set` retunes it mid-stream (the riser sweeps its band)
export function biquad(type: FilterType, f: number, q = 0.707, db = 0): Biquad {
  let c = coef(type, f, q, db);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const run: Filter = (x) => { const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  const set = (nf: number, nq = q): void => { c = coef(type, nf, nq, db); };
  return Object.assign(run, { set });
}
export function filt(buf: Float32Array, ...fs: readonly Filter[]): Float32Array {
  for (const f of fs) for (let i = 0; i < buf.length; i++) buf[i] = f(buf[i]);
  return buf;
}

// ---------- oscillators, envelopes, noise ----------
// band-limited saw (polyBLEP)
function blep(t: number, dt: number): number {
  if (t < dt) { const u = t / dt; return u + u - u * u - 1; }
  if (t > 1 - dt) { const u = (t - 1) / dt; return u * u + u + u + 1; }
  return 0;
}
const SHAPES = {
  sine: (ph: number) => Math.sin(TAU * ph),
  saw: (ph: number, dt: number) => 2 * ph - 1 - blep(ph, dt),
};
export function osc(kind: keyof typeof SHAPES, freq: number, sec: number, phase = 0): Float32Array {
  const n = Math.ceil(sec * SR), out = new Float32Array(n), shape = SHAPES[kind], dt = freq / SR;
  let ph = phase;
  for (let i = 0; i < n; i++) {
    out[i] = shape(ph, dt);
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return out;
}
// attack / decay / sustain / release envelope over `sec`
export function adsr(sec: number, a: number, d: number, s: number, r: number): Float32Array {
  const n = Math.ceil(sec * SR), A = a * SR, D = d * SR, R = r * SR, hold = n - R;
  return tabulate(n, (i) => {
    const v = i < A ? i / A : i < A + D ? 1 - (1 - s) * ((i - A) / D) : s;
    return i > hold ? v * Math.max(0, 1 - (i - hold) / R) : v;
  });
}
export const expDecay = (sec: number, tau: number): Float32Array => tabulate(Math.ceil(sec * SR), (i) => Math.exp(-i / (tau * SR)));

export function noise(sec: number, r: Rng, pink = false): Float32Array {
  const n = Math.ceil(sec * SR), o = new Float32Array(n);
  if (!pink) { for (let i = 0; i < n; i++) o[i] = r() * 2 - 1; return o; }
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    o[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return o;
}

// ---------- Freeverb (Jezar), stereo, tuned for 48 kHz ----------
type Lines = { readonly buf: readonly Float32Array[]; readonly idx: Int32Array };
const makeLines = (taps: readonly number[], spread: number): Lines => ({ buf: taps.map((t) => new Float32Array(t + spread)), idx: new Int32Array(taps.length) });

function combSum(c: Lines, flt: Float64Array, x: number, room: number, damp: number): number {
  let y = 0;
  for (let j = 0; j < c.buf.length; j++) {
    const b = c.buf[j], o = b[c.idx[j]];
    flt[j] = o * (1 - damp) + flt[j] * damp;
    b[c.idx[j]] = x + flt[j] * room;
    c.idx[j] = (c.idx[j] + 1) % b.length;
    y += o;
  }
  return y;
}
function allpass(a: Lines, input: number): number {
  let y = input;
  for (let j = 0; j < a.buf.length; j++) {
    const b = a.buf[j], o = b[a.idx[j]], v = -y + o;
    b[a.idx[j]] = y + o * 0.5;
    a.idx[j] = (a.idx[j] + 1) % b.length;
    y = v;
  }
  return y;
}
export function reverb(bus: Bus, { room = 0.82, damp = 0.35, wet = 1 } = {}): Bus {
  const k = SR / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((x) => Math.round(x * k));
  const apT = [556, 441, 341, 225].map((x) => Math.round(x * k));
  const out = makeBus(bus.n / SR);
  const channels: readonly (readonly [Float32Array, Float32Array, number])[] = [[bus.L, out.L, 0], [bus.R, out.R, Math.round(23 * k)]];
  for (const [src, dst, spread] of channels) {
    const combs = makeLines(combT, spread), aps = makeLines(apT, spread), flt = new Float64Array(combT.length);
    for (let n = 0; n < bus.n; n++) dst[n] = allpass(aps, combSum(combs, flt, src[n] * 0.015, room, damp)) * wet;
  }
  return out;
}

// ping-pong delay
export function delay(bus: Bus, time: number, fb = 0.35, lp = 4500): Bus {
  const d = Math.round(time * SR), out = makeBus(bus.n / SR);
  const bl = new Float32Array(d), br = new Float32Array(d);
  const fl = biquad("lp", lp), fr = biquad("lp", lp);
  for (let i = 0, j = 0; i < bus.n; i++, j = (j + 1) % d) {
    const ol = bl[j], or = br[j];
    bl[j] = fl(bus.L[i] + or * fb); br[j] = fr(bus.R[i] * 0.4 + ol * fb);
    out.L[i] = ol; out.R[i] = or;
  }
  return out;
}
