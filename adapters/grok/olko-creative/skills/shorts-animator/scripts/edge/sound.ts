// The soundtrack: every take at its moment on one voice track, the score, and the ducked mix.
import path from "node:path";
import { PRESETS, renderSoundtrack } from "../audio/soundtrack.ts";
import type { Short, Take, Timeline } from "../domain/types.ts";
import { mix, mkdir, pcm, SR, wav } from "./media.ts";

export const MOODS = ["tender", "hopeful", "night", "wonder", "playful"];
const LEAD_IN = 0.05;

type Placed = { readonly at: number; readonly data: Float32Array };

const place = (tl: Timeline) => (t: Take, i: number): readonly Placed[] => {
  if (!t.file) return [];
  const at = tl.voiceAt[i] ?? 0;
  return t.slice
    ? [{ at: Math.round((at - LEAD_IN) * SR), data: pcm(t.file, Math.max(0, (t.from ?? 0) - LEAD_IN), t.dur + 0.15) }]
    : [{ at: Math.round(at * SR), data: pcm(t.file) }];
};

/** Sums the takes into one buffer; a take that runs past the end is cut there. */
function voiceTrack(tl: Timeline, takes: readonly Placed[]): Float32Array {
  const track = new Float32Array(Math.ceil((tl.duration + 0.5) * SR));
  takes.forEach(({ at, data }) => data.subarray(0, Math.max(0, track.length - at)).forEach((x, j) => { track[at + j] = (track[at + j] ?? 0) + x; }));
  return track;
}

/** Returns the mixed WAV the encoder muxes in. */
export function soundtrack(dir: string, s: Short, tl: Timeline, takes: readonly Take[]): string {
  const a = mkdir(dir, "build", "audio");
  const placed = takes.flatMap(place(tl));
  const voice = path.join(a, "voice.wav");
  wav(voice, voiceTrack(tl, placed));
  const m = s.music;
  const own = !MOODS.includes(m.mood) && !(m.mood in PRESETS);
  const music = m.mood === "none" ? null : path.join(a, "music.wav");
  if (music) {
    renderSoundtrack(
      { duration: tl.duration, preset: own ? "tender" : m.mood, music: own ? path.resolve(dir, m.mood) : "auto", cues: [], outroAt: tl.duration - 1.5, musicStart: m.start },
      music,
      { seed: m.seed ?? 11 },
    );
  }
  const hasVoice = placed.length > 0;
  const volume = m.volume ?? (hasVoice ? 0.42 : 0.9);
  return mix({ voice, music, hasVoice, volume, duration: tl.duration }, path.join(a, "mix.wav"));
}
