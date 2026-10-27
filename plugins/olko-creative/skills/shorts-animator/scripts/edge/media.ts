// ffmpeg and files: every process and disk write the pipeline makes, kept out of the domain.
import { spawn, spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Json, Timeline } from "../domain/types.ts";

export const SR = 48000;

export function run(cmd: string, args: readonly string[], opts: SpawnSyncOptions = {}): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) {
    const out = String(r.stderr || r.stdout || r.error?.message || "");
    throw new Error(`${cmd} ${args.slice(0, 3).join(" ")}... failed:\n${out.slice(-1500)}`);
  }
  return String(r.stdout);
}

export const has = (cmd: string, args: readonly string[] = ["-version"]): boolean => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;

export const readJson = (f: string): unknown => JSON.parse(fs.readFileSync(f, "utf8"));
export const writeJson = (f: string, v: Json | object): void => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
export const mkdir = (...parts: string[]): string => {
  const d = path.join(...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

export const duration = (f: string): number =>
  parseFloat(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]));

/** Mono 48 kHz float samples of a file, or of a slice of it. */
export function pcm(file: string, from = 0, dur?: number): Float32Array {
  const args = ["-v", "error", ...(from ? ["-ss", String(from)] : []), ...(dur ? ["-t", String(dur)] : []), "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"];
  const b = spawnSync("ffmpeg", args, { maxBuffer: 1 << 30 }).stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}

export function wav(file: string, data: Float32Array): void {
  const n = data.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  data.forEach((x, i) => buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x * 32767))), 44 + i * 2));
  fs.writeFileSync(file, buf);
}

export type Mix = { readonly voice: string; readonly music: string | null; readonly hasVoice: boolean; readonly volume: number; readonly duration: number };

/** Voice ducks the music (sidechain), then loudness to the -14 LUFS the platforms normalise to. */
const MIX_ARGS: Record<"both" | "music" | "voice", (m: Mix) => readonly string[]> = {
  both: (m) => ["-i", m.voice, "-i", m.music ?? "", "-filter_complex",
    `[1:a]volume=${m.volume}[m];[0:a]asplit=2[v][sc];[m][sc]sidechaincompress=threshold=0.04:ratio=3:attack=30:release=500[md];[v][md]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[o]`,
    "-map", "[o]", "-ar", String(SR)],
  music: (m) => ["-i", m.music ?? "", "-af", `volume=${m.volume},loudnorm=I=-15:TP=-1.5`],
  voice: (m) => ["-i", m.voice, "-af", "loudnorm=I=-14:TP=-1.5"],
};

export function mix(m: Mix, out: string): string {
  const kind = m.music && m.hasVoice ? "both" : m.music ? "music" : "voice";
  run("ffmpeg", ["-v", "error", "-y", ...MIX_ARGS[kind](m), "-t", String(m.duration), out]);
  return out;
}

const sheetWidth = (tl: Timeline): number => (tl.W > tl.H ? 480 : 300);
const tile = (tl: Timeline): string => {
  const cols = Math.min(6, tl.beats.length);
  return `scale=${sheetWidth(tl)}:-2,tile=${cols}x${Math.ceil(tl.beats.length / cols)}:padding=6:color=white`;
};

/** One contact sheet from numbered stills (frames/s000.jpg...). */
export const stillSheet = (tl: Timeline, pattern: string, out: string): void =>
  void run("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", pattern, "-vf", tile(tl), "-frames:v", "1", out]);

/** One frame per shot, taken from the finished file at 60% of the shot: what a viewer actually sees. */
export function videoSheet(tl: Timeline, video: string, out: string): void {
  const sel = tl.beats.map((b) => `between(t\\,${(b.start + b.dur * 0.6).toFixed(2)}\\,${(b.start + b.dur * 0.6 + 0.04).toFixed(2)})`).join("+");
  run("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `select='${sel}',${tile(tl)}`, "-frames:v", "1", "-fps_mode", "vfr", out]);
}

export type Encoder = { readonly write: (jpeg: Buffer) => Promise<void>; readonly done: () => Promise<number> };

/** Drawings in at fps/twos, out at fps: each drawing holds for `twos` frames, like hand animation. */
// Every drawing is re-stroked, so nothing carries over between them and quality alone sets the size:
// crf 17 made ~50 Mbit/s, crf 23 halves it with no visible change. The JPEGs arrive full-range;
// converting to tv range stops players and platforms from showing them with the wrong contrast.
export function encoder(tl: Timeline, audio: string, out: string): Encoder {
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(tl.fps / tl.twos), "-i", "-", "-i", audio,
    "-map", "0:v", "-map", "1:a", "-r", String(tl.fps), "-vf", "scale=out_range=tv", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
    "-pix_fmt", "yuv420p", "-color_range", "tv", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k", "-shortest", out], { stdio: ["pipe", "inherit", "inherit"] });
  const closed = new Promise<number>((r) => ff.on("close", (code) => r(code ?? 1)));
  return {
    write: (buf) => new Promise((r) => (ff.stdin.write(buf) ? r() : ff.stdin.once("drain", () => r()))),
    done: () => {
      ff.stdin.end();
      return closed;
    },
  };
}

export const jpeg = (dataUrl: unknown): Buffer => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) throw new Error("the page returned no image");
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
};
