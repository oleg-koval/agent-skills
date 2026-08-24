#!/usr/bin/env node
// Stop hook: after a substantial answer, make the model offer the user a
// critical-thinking review (adversarial critic agent, per the /self-critique skill).
// The hook only NUDGES. It cannot spawn agents or run the loop itself.
//
// ponytail: "substantial" = final assistant prose >= THRESHOLD chars. Known ceiling:
// misses short-but-dense tool-heavy turns. Upgrade path: also count tool_use blocks
// since the last user message if length alone misfires.
import { readFileSync } from 'node:fs';

const THRESHOLD = 1500;
const OFFER_MARKER = /critical-thinking review/i; // the offer line must contain this; doubles as a loop guard

function bail() { process.exit(0); } // any uncertainty => do nothing, never block the user

let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { bail(); }

let input;
try { input = JSON.parse(raw); } catch { bail(); }

// Loop guard #1: if this hook already forced a continuation, let the turn end.
if (input.stop_hook_active) bail();

const path = input.transcript_path;
if (!path) bail();

let lines;
try { lines = readFileSync(path, 'utf8').trim().split('\n'); } catch { bail(); }

// Walk from the end; grab the final assistant message that has text content.
let text = '';
for (let i = lines.length - 1; i >= 0; i--) {
  let obj;
  try { obj = JSON.parse(lines[i]); } catch { continue; }
  const msg = obj.message;
  if (obj.type === 'assistant' && msg && Array.isArray(msg.content)) {
    text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (text.trim()) break;
  }
}

if (text.length < THRESHOLD) bail();

// Loop guard #2: the answer already carries the offer (e.g. I added it last turn).
if (OFFER_MARKER.test(text)) bail();

const reason =
  'That was a substantial answer. Before ending the turn, append exactly ONE short line ' +
  'offering the user a "critical-thinking review": ask whether they want you to run /self-critique ' +
  '(spawn an adversarial critic agent that challenges this answer, checks similar issues, finds ' +
  'patterns, and reports where you were wrong, iterations-to-satisfy, the numeric improvement, and a ' +
  'final score). The offer line MUST contain the phrase "critical-thinking review". Do NOT run the ' +
  'critique now and do not re-explain the answer. Just offer it, then stop.';

process.stdout.write(JSON.stringify({ decision: 'block', reason }));
bail();
