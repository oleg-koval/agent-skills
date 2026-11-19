#!/usr/bin/env node
// One-line progress status for lekker-review: a boat drifts over a tide line toward a lighthouse.
//
// Usage: node lekker-progress.mjs --stage <stage> --message "<short fact>" [--ascii]
//
// Each call prints exactly one line and exits 0, even on bad arguments. On a TTY it first animates
// the drift on that line (at most 10 fps, under a second); anywhere else (captured tool output, a
// log) or with NO_COLOR or --ascii it prints the final frame only, with no escape codes.
// The `decision` stage prints a compass line and leaves the boat where it was.

import { pathToFileURL } from 'node:url';

export const SLOTS = 8;
export const MAX_WIDTH = 72;
const FRAME_MS = 100;

// stage -> [slot the boat reaches, mood, default message]
export const STAGES = {
  start:    [0, 'neutral', 'parsed the request'],
  context:  [1, 'neutral', 'context ready'],
  review:   [2, 'neutral', 'review agents started'],
  verify:   [3, 'neutral', 'verifying findings'],
  critic:   [4, 'neutral', 'completeness critic'],
  prove:    [5, 'neutral', 'proving bugs with tests'],
  fix:      [6, 'neutral', 'applying fixes'],
  post:     [7, 'neutral', 'posting the review'],
  success:  [SLOTS, 'happy', 'review saved'],
  failure:  [4, 'sad', 'review stopped'],
  decision: [null, 'neutral', 'decision'],
};

const GLYPHS = {
  false: { boat: '⛵', light: '🗼', tide: ' ~', compass: '🧭 ', neutral: '', happy: '😌', sad: '🌧️' },
  true:  { boat: '^', light: 'I', tide: '.', compass: '> ', neutral: '', happy: '(^o^)', sad: '(T.T)' },
};

const WIDE = [[0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x25fd, 0x25fe], [0x2614, 0x2615],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26f5, 0x26f5], [0x2e80, 0xa4cf], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f000, 0x1ffff]];

function cellWidth(ch) {
  const cp = ch.codePointAt(0);
  if (/\p{M}/u.test(ch) || cp === 0x200d || cp === 0xfe0f) return 0;
  return WIDE.some(([lo, hi]) => cp >= lo && cp <= hi) ? 2 : 1;
}

export const width = (text) => [...text].reduce((n, ch) => n + cellWidth(ch), 0);

export function truncate(text, limit) {
  const { out, done } = [...text].reduce((acc, ch) => {
    if (acc.done) return acc;
    const next = acc.used + cellWidth(ch);
    return next > limit - 1 ? { ...acc, done: true } : { out: acc.out + ch, used: next, done: false };
  }, { out: '', used: 0, done: false });
  return done ? `${out}…` : out;
}

const oneLine = (text) => String(text ?? '').split(/\s+/).filter(Boolean).join(' ');
const fit = (line) => (width(line) <= MAX_WIDTH ? line : truncate(line, MAX_WIDTH));

function track(slot, glyphs) {
  const cells = Array.from({ length: SLOTS + 1 }, (_, i) => (i === SLOTS ? glyphs.light : glyphs.tide));
  return cells.map((cell, i) => (i === Math.min(slot, SLOTS) ? glyphs.boat : cell)).join('');
}

// Pure: `tick` is the boat's slot. The mood face shows once the boat has arrived.
export function frame(stage, tick, { message, ascii = false } = {}) {
  const spec = STAGES[stage];
  const glyphs = GLYPHS[ascii === true];
  const text = oneLine(message ?? spec?.[2] ?? '');
  if (!spec) return fit(`lekker: ${text || stage || 'progress'}`);
  const [target, mood] = spec;
  if (target === null) return fit(`${glyphs.compass}${text || spec[2]}`);
  const face = tick >= target ? glyphs[mood] : '';
  return fit(`${`${track(tick, glyphs)} ${face}`.trimEnd()}  ${stage}: ${text}`);
}

const arg = (argv, name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(argv) {
  const stage = arg(argv, 'stage') ?? '';
  const message = arg(argv, 'message');
  const ascii = argv.includes('--ascii') || Boolean(process.env.LEKKER_PROGRESS_ASCII);
  const spec = STAGES[stage];
  const animate = process.stdout.isTTY === true && !process.env.NO_COLOR && !ascii && Array.isArray(spec) && spec[0] !== null;
  if (animate) {
    const target = spec[0];
    const slots = Array.from({ length: Math.min(3, target) }, (_, i) => target - 3 + i).filter((s) => s >= 0);
    for (const slot of slots) {
      process.stdout.write(`\r\x1b[2K${frame(stage, slot, { message, ascii })}`);
      await sleep(FRAME_MS);
    }
    process.stdout.write('\r\x1b[2K');
  }
  const target = spec && spec[0] !== null ? spec[0] : 0;
  process.stdout.write(`${frame(stage, target, { message, ascii })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2)); } catch { /* decoration must never fail a review */ }
  process.exitCode = 0;
}
