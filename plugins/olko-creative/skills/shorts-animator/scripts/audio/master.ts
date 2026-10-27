// Mastering: gentle bus glue and a look-ahead brickwall, peaks held under the ceiling without pumping.
import { SR, biquad, dbToGain } from "./dsp.ts";
import type { Bus } from "./dsp.ts";

// presence (the instruments are voiced dark, so the top is lifted broadly, never a narrow treble boost)
// and a little tape saturation. The filters keep per-channel memory, so each channel gets its own.
function eqChannel(ch: Float32Array): void {
  const hp = biquad("hp", 32), lo = biquad("lowshelf", 110, 0.7, -1.5), hi = biquad("highshelf", 2200, 0.6, 5);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(1.15 * hi(lo(hp(ch[i])))) / Math.tanh(1.15);
}
// a soft knee on the loudest transients first, so the limiter barely has to work
function softKnee(ch: Float32Array, knee: number): void {
  for (let i = 0; i < ch.length; i++) {
    const x = ch[i], a = Math.abs(x);
    if (a > knee) ch[i] = Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
}
// sample peaks and the half-sample peaks between them (cubic interpolation ~ true peak)
const half = (x: Float32Array, i: number): number => (-(x[i - 1] || 0) + 9 * x[i] + 9 * (x[i + 1] || 0) - (x[i + 2] || 0)) / 16;
const peakAmp = (bus: Bus): Float32Array =>
  Float32Array.from({ length: bus.n }, (_, i) => Math.max(Math.abs(bus.L[i]), Math.abs(bus.R[i]), Math.abs(half(bus.L, i)), Math.abs(half(bus.R, i))));

// the exact max over the next `look` samples (monotonic queue); kept as one loop, the queue is the mechanism
function wantedGain(amp: Float32Array, look: number, ceil: number): Float32Array {
  const n = amp.length, want = new Float32Array(n), q = new Int32Array(n);
  let h = 0, t = 0;
  for (let i = 0, j = 0; i < n; i++) {
    for (; j < Math.min(n, i + look); j++) { while (t > h && amp[q[t - 1]] <= amp[j]) t--; q[t++] = j; }
    while (q[h] < i) h++;
    const pk = amp[q[h]];
    want[i] = pk > ceil ? ceil / pk : 1;
  }
  return want;
}
// gain glides down before a peak arrives (attack over the look-ahead) and recovers over ~120 ms
function applyGlide(bus: Bus, want: Float32Array): void {
  const rel = Math.exp(-1 / (0.12 * SR));
  let g = 1;
  for (let i = 0; i < bus.n; i++) {
    const w = want[i];
    g = w < g ? w : w - (w - g) * rel;
    bus.L[i] *= g; bus.R[i] *= g;
  }
}
const hardClip = (ch: Float32Array, ceil: number): void => {
  for (let i = 0; i < ch.length; i++) { if (ch[i] > ceil) ch[i] = ceil; else if (ch[i] < -ceil) ch[i] = -ceil; }
};

export function master(bus: Bus, eq = true): void {
  if (eq) { eqChannel(bus.L); eqChannel(bus.R); }
  const knee = dbToGain(-6), look = Math.round(0.005 * SR), ceil = dbToGain(-2.3);
  softKnee(bus.L, knee); softKnee(bus.R, knee);
  applyGlide(bus, wantedGain(peakAmp(bus), look, ceil));
  hardClip(bus.L, ceil); hardClip(bus.R, ceil);
}
