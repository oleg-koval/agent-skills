// audio: the soundtrack, composed and mixed offline for each video.
// A music bed in the style's genre, in tempo, warm and low (played instruments, not beeps), one stereo mix,
// -16 LUFS. Pure JS synthesis (no samples), seeded so a rebuild sounds identical. ffmpeg measures loudness.
// This file is the edge: ffmpeg reads and loudness, WAV writes, the mastering loop.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { PRESETS, composeMusic } from "./compose.ts";
import type { Preset } from "./compose.ts";
import { SR, busGain, busMixFrom, clamp, dbToGain, makeBus, rng } from "./dsp.ts";
import type { Bus, Rng } from "./dsp.ts";
import { master } from "./master.ts";

export { SR } from "./dsp.ts";
export { PRESETS } from "./compose.ts";

// `cues` (sound effects) is accepted for old callers and ignored.
export type Plan = {
  duration: number;
  style?: string;
  preset?: string;
  bpm?: number;
  boundaries?: readonly number[];
  outroAt?: number;
  cues?: readonly unknown[];
  music?: string; // "auto" | "none" | a file path
  musicVolume?: number;
  musicStart?: number;
};
export type Report = {
  music: string;
  preset: string | undefined;
  bpm: number;
  sfx: number;
  lufs: number | null;
  truePeak: number | null;
};
type Loud = { readonly I: number; readonly TP: number };

// ---------- ffmpeg and files ----------
function writeWav(file: string, bus: Bus, seconds: number): void {
  const n = Math.min(bus.n, Math.round(seconds * SR));
  const b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.round(clamp(bus.L[i], -1, 1) * 32767), 44 + i * 4); b.writeInt16LE(Math.round(clamp(bus.R[i], -1, 1) * 32767), 46 + i * 4); }
  fs.writeFileSync(file, b);
}
function readAudio(file: string, seconds: number): Bus | null {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-t", String(seconds), "-f", "f32le", "-ac", "2", "-ar", String(SR), "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) return null;
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  const bus = makeBus(f.length / 2 / SR);
  for (let i = 0; i < bus.n; i++) { bus.L[i] = f[i * 2]; bus.R[i] = f[i * 2 + 1]; }
  return bus;
}
function loudness(file: string): Loud | null {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const m = /\{[\s\S]*\}/.exec(r.stderr || "");
  if (!m) return null;
  try {
    const j: unknown = JSON.parse(m[0]);
    if (typeof j !== "object" || j === null) return null;
    return { I: "input_i" in j ? Number(j.input_i) : NaN, TP: "input_tp" in j ? Number(j.input_tp) : NaN };
  } catch { return null; }
}

// ---------- the bed ----------
const presetFor = (plan: Plan): Preset => {
  const pick = (name: string | undefined): Preset | undefined => (name !== undefined && Object.hasOwn(PRESETS, name) ? PRESETS[name] : undefined);
  const base = pick(plan.preset) ?? pick(plan.style) ?? PRESETS.keynote;
  return plan.bpm ? { ...base, bpm: plan.bpm } : base;
};
// your own track, trimmed to the video, faded in and out under the volume
function addOwnTrack(mix: Bus, plan: Plan, file: string): void {
  const m = readAudio(file, plan.duration + (plan.musicStart || 0) + 3);
  if (!m) return;
  const off = Math.round((plan.musicStart || 0) * SR), fo = Math.round(Math.min(2, plan.duration * 0.1) * SR), end = Math.round(plan.duration * SR);
  for (let i = 0; i < end && i + off < m.n; i++) {
    const g = Math.min(1, i / (0.25 * SR)) * (i > end - fo ? (end - i) / fo : 1) * (plan.musicVolume ?? 0.8);
    mix.L[i] += m.L[i + off] * g; mix.R[i] += m.R[i + off] * g;
  }
}
function addMusic(mix: Bus, plan: Plan, P: Preset, r: Rng, ham: Rng): void {
  if (plan.music === "auto" || plan.music == null) busMixFrom(mix, composeMusic(P, plan, r, ham), 0.9);
  else if (plan.music && plan.music !== "none") addOwnTrack(mix, plan, plan.music);
}

// ---------- loudness loop ----------
// -16 LUFS integrated (full, not loud) with peaks under -2 dBTP (headroom for the AAC encode). A few passes of
// gain -> soft knee + limiter -> measure, so transient-heavy styles get there too.
function trimPeaks(mix: Bus, outFile: string, seconds: number, L2: Loud | null): Loud | null {
  if (!L2 || L2.TP <= -1.95) return L2;
  busGain(mix, dbToGain(-2.05 - L2.TP));
  writeWav(outFile, mix, seconds);
  return loudness(outFile);
}
function loudnessPass(mix: Bus, outFile: string, seconds: number, L2: Loud | null, pass: number): Loud | null {
  if (pass >= 4 || !L2 || !isFinite(L2.I)) return L2;
  const g = clamp(-16 - L2.I, -20, 20);
  if (Math.abs(g) < 0.25 && L2.TP <= -1.95) return L2;
  busGain(mix, dbToGain(g));
  master(mix, false);
  writeWav(outFile, mix, seconds);
  return loudnessPass(mix, outFile, seconds, trimPeaks(mix, outFile, seconds, loudness(outFile)), pass + 1);
}

export function renderSoundtrack(plan: Plan, outFile: string, { seed = 7 }: { seed?: number } = {}): Report {
  const r = rng(seed), ham = rng(seed + 1), P = presetFor(plan);
  const seconds = plan.duration + 0.05;
  const mix = makeBus(plan.duration + 3);
  addMusic(mix, plan, P, r, ham);
  master(mix);
  const tmp = outFile.replace(/\.wav$/, ".pre.wav");
  writeWav(tmp, mix, seconds);
  const L2 = loudnessPass(mix, outFile, seconds, loudness(tmp), 0);
  if (!fs.existsSync(outFile)) writeWav(outFile, mix, seconds);
  fs.rmSync(tmp, { force: true });
  return { music: plan.music || "auto", preset: plan.preset || plan.style, bpm: P.bpm, sfx: 0, lufs: L2 ? L2.I : null, truePeak: L2 ? L2.TP : null };
}
