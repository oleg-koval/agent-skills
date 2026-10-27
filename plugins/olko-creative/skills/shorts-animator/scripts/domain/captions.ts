import type { Line } from "./types.ts";

// "*" and "|" are emphasis and pause marks for the writer; they are never spoken or shown.
export const words = (s: string): readonly string[] => s.replace(/\*|\|/g, "").split(/\s+/).filter(Boolean);

const STOP = /[,.;:!?…\u2014]$/;

/** How many words the next chunk takes: an even share, nudged one word to land on punctuation. */
function chunkSize(w: readonly string[], n: number, i: number, parts: number): number {
  const left = w.length - i;
  const even = Math.round(left / parts);
  const nudge = [0, 1, -1].find((d) => {
    const size = even + d;
    return size >= 2 && left - size >= 2 && size <= n && STOP.test(w[i + size - 1] ?? "");
  });
  return even + (nudge ?? 0);
}

function split(w: readonly string[], n: number, i: number, parts: number): readonly string[] {
  if (parts <= 1) return [w.slice(i).join(" ")];
  const size = chunkSize(w, n, i, parts);
  return [w.slice(i, i + size).join(" "), ...split(w, n, i + size, parts - 1)];
}

/** Balanced chunks of at most n words (7 words become 4 + 3, not 5 + 2). */
export function chunks(text: string, n: number): readonly string[] {
  const w = words(text);
  return w.length <= n ? [w.join(" ")] : split(w, n, 0, Math.ceil(w.length / n));
}

/** A "/" in a line's caption forces a break there; in spoken text it is just a character ("and/or"). */
export function captionChunks(line: Line, n: number): readonly string[] {
  if (line.caption?.includes("/")) return line.caption.split("/").map((x) => x.trim()).filter(Boolean);
  return chunks(line.caption ?? line.say, n);
}
