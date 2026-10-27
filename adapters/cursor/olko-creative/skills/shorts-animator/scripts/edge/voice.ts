// The narrator: Kokoro-82M in a private Python, or the person's own recording, timed by transcript.
// Everything is pinned and the model files are checked by sha256, so a setup is the same setup.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { words } from "../domain/captions.ts";
import { isMap } from "../domain/schema.ts";
import type { Json, Short, Take } from "../domain/types.ts";
import { duration, mkdir, run } from "./media.ts";

const HOME = path.join(os.homedir(), ".cache", "shorts-animator");
const VENV = path.join(HOME, "venv");
const PY = path.join(VENV, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const TTS = path.join(import.meta.dirname, "..", "tts.py");
const PACKAGES = ["kokoro-onnx==0.6.1", "soundfile==0.14.0"];
export const HYPERFRAMES = "hyperframes@0.8.150";
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";
const MODEL = {
  "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
  "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
};
type ModelFile = keyof typeof MODEL;

export const hash = (...xs: readonly Json[]): string =>
  crypto.createHash("sha1").update(xs.map((x) => JSON.stringify(x)).join("|")).digest("hex").slice(0, 10);

const sha256 = (f: string): string => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

/** HyperFrames' cache first (it ships the same files), then ours. */
const modelFiles = (): readonly [string, string] | undefined => {
  const hf = path.join(os.homedir(), ".cache", "hyperframes", "tts");
  const pairs: readonly (readonly [string, string])[] = [
    [path.join(hf, "models", "kokoro-v1.0.onnx"), path.join(hf, "voices", "voices-v1.0.bin")],
    [path.join(HOME, "kokoro", "kokoro-v1.0.onnx"), path.join(HOME, "kokoro", "voices-v1.0.bin")],
  ];
  return pairs.find(([m, v]) => fs.existsSync(m) && fs.existsSync(v));
};

const pythonReady = (): boolean => fs.existsSync(PY) && spawnSync(PY, ["-I", "-c", "import kokoro_onnx, soundfile"]).status === 0;
export const narratorReady = (): boolean => pythonReady() && modelFiles() !== undefined;

const PYTHONS = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python", "py"];
const modernPython = (): string | undefined =>
  PYTHONS.find((b) => spawnSync(b, ["-c", "import sys; print(sys.version_info >= (3, 10) and sys.version_info < (3, 14))"], { encoding: "utf8" }).stdout?.trim() === "True");

function installPython(log: (m: string) => void): string | undefined {
  mkdir(HOME);
  if (spawnSync("uv", ["--version"]).status === 0) {
    log("· setting up the narrator's Python (uv)...");
    spawnSync("uv", ["venv", "-q", "--allow-existing", "-p", "3.12", VENV], { stdio: "inherit" });
    spawnSync("uv", ["pip", "install", "-q", "-p", PY, ...PACKAGES], { stdio: "inherit" });
  } else {
    const py = modernPython();
    if (!py) return 'the narrator needs Python 3.10 to 3.13, or uv (https://docs.astral.sh/uv/). Or set voice to "none", or use your own recording';
    log(`· setting up the narrator's Python (${py})...`);
    spawnSync(py, ["-m", "venv", VENV], { stdio: "inherit" });
    spawnSync(PY, ["-m", "pip", "install", "-q", ...PACKAGES], { stdio: "inherit" });
  }
  return pythonReady() ? undefined : `couldn't install ${PACKAGES.join(" ")} into ${VENV}`;
}

async function download(dir: string, f: ModelFile, log: (m: string) => void): Promise<string | undefined> {
  log(`· downloading the voice model: ${f}...`);
  const res = await fetch(`${RELEASE}/${f}`);
  if (!res.ok) return `couldn't download ${f} (${res.status})`;
  const part = path.join(dir, f + ".part");
  fs.writeFileSync(part, Buffer.from(await res.arrayBuffer()));
  if (sha256(part) !== MODEL[f]) {
    fs.rmSync(part);
    return `${f} failed its checksum; nothing was installed`;
  }
  fs.renameSync(part, path.join(dir, f));
  return undefined;
}

/** Sets the narrator up. Returns undefined when ready, or what is missing. */
export async function setupNarrator(log: (m: string) => void = console.log): Promise<string | undefined> {
  const py = pythonReady() ? undefined : installPython(log);
  if (py || modelFiles()) return py;
  const dir = mkdir(HOME, "kokoro");
  const files: readonly ModelFile[] = ["voices-v1.0.bin", "kokoro-v1.0.onnx"];
  return files.reduce<Promise<string | undefined>>(async (prev, f) => (await prev) ?? download(dir, f, log), Promise.resolve(undefined));
}

/* ------------------------------------------------------------------ takes */

const silent = (s: Short): readonly Take[] => s.lines.map((l) => ({ file: null, dur: Math.max(1.3, words(l.say).length * 0.36) }));

type Job = { readonly text: string; readonly file: string };

const kokoroJobs = (s: Short, vdir: string, id: string, speed: number): readonly (Job & { readonly fresh: boolean })[] =>
  s.lines.map((l, i) => {
    const text = (l.speak ?? l.say).replace(/\*|\|/g, "");
    const n = String(i + 1).padStart(2, "0");
    const file = path.join(vdir, `${n}-${hash(text, id, speed)}.wav`);
    return { text, file, fresh: fs.existsSync(file) };
  });

/** A line's text changed: its old take goes, so the folder never holds two takes of one line. */
const dropStale = (vdir: string, file: string): void => {
  const prefix = path.basename(file).slice(0, 3);
  fs.readdirSync(vdir).filter((f) => f.startsWith(prefix) && f !== path.basename(file)).forEach((f) => fs.rmSync(path.join(vdir, f)));
};

async function kokoro(s: Short, vdir: string, id: string, speed: number, quiet: boolean): Promise<readonly Take[]> {
  const jobs = kokoroJobs(s, vdir, id, speed);
  const todo = jobs.filter((j) => !j.fresh);
  if (todo.length) {
    const why = narratorReady() ? undefined : await setupNarrator();
    const files = modelFiles();
    if (why || !files) throw new Error(why ?? "no voice model");
    todo.forEach((j) => dropStale(vdir, j.file));
    if (!quiet) console.log(`· narrating ${todo.length} line${todo.length > 1 ? "s" : ""} with ${id} (Kokoro, on this computer)...`);
    run(PY, ["-I", TTS, ...files, id, String(speed)], { input: JSON.stringify(todo.map((j) => [j.text, j.file])) });
  }
  return jobs.map((j) => ({ file: j.file, dur: duration(j.file) }));
}

type Word = { readonly start: number; readonly end: number };

/** Every {word|text, start, end} in a transcript, wherever the tool nested it. */
const pickWords = (o: Json | undefined): readonly Word[] => {
  if (Array.isArray(o)) return o.flatMap(pickWords);
  if (!isMap(o)) return [];
  const { start, end } = o;
  if ((o.word || o.text) && typeof start === "number" && typeof end === "number" && !o.words) return [{ start, end }];
  return Object.values(o).flatMap(pickWords);
};

const parseTranscript = (raw: string): Json | undefined => {
  try {
    const v: unknown = JSON.parse(raw.slice(raw.indexOf("{")));
    return isMap(v) ? v : undefined;
  } catch {
    return undefined;
  }
};

function transcriptWords(src: string, vdir: string, quiet: boolean): readonly Word[] {
  const tj = path.join(vdir, `transcript-${hash(fs.statSync(src).mtimeMs, src)}.json`);
  if (!fs.existsSync(tj)) {
    if (!quiet) console.log("· transcribing your recording for the timing...");
    fs.writeFileSync(tj, run(NPX, ["--yes", HYPERFRAMES, "transcribe", src, "--json", "-d", vdir], { cwd: vdir }));
  }
  const direct = pickWords(parseTranscript(fs.readFileSync(tj, "utf8")));
  const side = fs.readdirSync(vdir).find((f) => f.endsWith("transcript.json") && !f.startsWith("transcript-"));
  const ws = direct.length || !side ? direct : pickWords(parseTranscript(fs.readFileSync(path.join(vdir, side), "utf8")));
  return ws.toSorted((a, b) => a.start - b.start);
}

/** Their own recording: each line takes the next run of words, in order. */
function ownRecording(s: Short, dir: string, vdir: string, file: string, quiet: boolean): readonly Take[] {
  const src = path.resolve(dir, file);
  if (!fs.existsSync(src)) throw new Error(`voice.file ${file} not found`);
  const ws = transcriptWords(src, vdir, quiet);
  if (!ws.length) throw new Error("couldn't read word timings from the transcript");
  const word = (i: number): Word => ws[Math.min(i, ws.length - 1)] ?? { start: 0, end: 0 };
  const firsts = s.lines.map((_, i) => s.lines.slice(0, i).reduce((n, l) => n + words(l.say).length, 0));
  return s.lines.map((l, i) => {
    const a = word(firsts[i] ?? 0);
    const b = word((firsts[i] ?? 0) + words(l.say).length - 1);
    return { file: src, from: a.start, dur: Math.max(0.6, b.end - a.start), slice: true };
  });
}

export async function narrate(dir: string, s: Short, quiet = false): Promise<readonly Take[]> {
  const vdir = mkdir(dir, "voice");
  const v = s.voice;
  if (v.kind === "none") return silent(s);
  if (v.kind === "file") return ownRecording(s, dir, vdir, v.file, quiet);
  return kokoro(s, vdir, v.id, v.speed, quiet);
}

/** Timing without narrating: cached Kokoro takes when every line has one, word-count estimates otherwise. */
export function cachedTakes(dir: string, s: Short): readonly Take[] {
  const v = s.voice;
  if (v.kind !== "kokoro") return silent(s);
  const jobs = kokoroJobs(s, path.join(dir, "voice"), v.id, v.speed);
  return jobs.every((j) => j.fresh) ? jobs.map((j) => ({ file: j.file, dur: duration(j.file) })) : silent(s);
}
