#!/usr/bin/env node
// Rule store over a directory of Claude Code memory files (Markdown + frontmatter).
// Frontmatter is parsed line by line so unrelated lines survive a rewrite byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FENCE = '---';
const EVIDENCE_LINE = /^\s*-\s.*\b20\d\d-\d\d-\d\d\b/;
const DAY_MS = 86_400_000;

const topLevelKey = (line) => /^([A-Za-z_][\w-]*):(?: (.*))?$/.exec(line);
const metaEntry = (line) => /^ {2}([A-Za-z_][\w-]*):(?: (.*))?$/.exec(line);

function splitFrontmatter(text) {
  if (!text.startsWith(`${FENCE}\n`)) return null;
  const rest = text.slice(FENCE.length + 1);
  const closeAt = rest.startsWith(`${FENCE}\n`) || rest === FENCE
    ? 0
    : rest.indexOf(`\n${FENCE}\n`) === -1
      ? (rest.endsWith(`\n${FENCE}`) ? rest.length - FENCE.length - 1 : -1)
      : rest.indexOf(`\n${FENCE}\n`) + 1;
  if (closeAt === -1) return null;
  const front = rest.slice(0, closeAt);
  const body = rest.slice(closeAt + FENCE.length + 1);
  return { frontLines: front === '' ? [] : front.replace(/\n$/, '').split('\n'), body };
}

// top keeps every frontmatter line in order; metadata children are lifted into `metadata`.
function readTop(frontLines) {
  const top = [];
  const metadata = {};
  let inMeta = false;
  for (const line of frontLines) {
    const meta = inMeta ? metaEntry(line) : null;
    if (meta) {
      metadata[meta[1]] = meta[2] ?? '';
      continue;
    }
    const key = topLevelKey(line);
    inMeta = key?.[1] === 'metadata';
    top.push({ key: key?.[1] ?? null, line });
  }
  return { top, metadata };
}

export function parseRule(text) {
  const parts = splitFrontmatter(text);
  if (!parts) return null;
  const { top, metadata } = readTop(parts.frontLines);
  const valueOf = (key) => {
    const entry = top.find((t) => t.key === key);
    return entry ? (topLevelKey(entry.line)?.[2] ?? '') : '';
  };
  return { name: valueOf('name'), description: valueOf('description'), metadata, body: parts.body, top };
}

function topLines(rule) {
  const hasMeta = rule.top.some((t) => t.key === 'metadata');
  const top = hasMeta || Object.keys(rule.metadata).length === 0
    ? rule.top
    : [...rule.top, { key: 'metadata', line: 'metadata:' }];
  return top.flatMap((t) =>
    t.key === 'metadata'
      ? [t.line, ...Object.entries(rule.metadata).map(([k, v]) => `  ${k}: ${v}`)]
      : [t.line],
  );
}

export function serializeRule(rule) {
  const lines = topLines(rule);
  return `${FENCE}\n${lines.length ? `${lines.join('\n')}\n` : ''}${FENCE}\n${rule.body}`;
}

function readRuleFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .flatMap((file) => {
      const rule = parseRule(fs.readFileSync(path.join(dir, file), 'utf8'));
      return rule && rule.name ? [{ file, rule }] : [];
    });
}

export const listRules = (dir) => readRuleFiles(dir).map((e) => e.rule);

export const checklistMarkdown = (dir) =>
  listRules(dir).map((r) => `- [${r.name}]: ${r.description}\n`).join('');

export function bumpFire(rule, isoDate) {
  const fires = Number.parseInt(rule.metadata.fires ?? '0', 10) || 0;
  return { ...rule, metadata: { ...rule.metadata, fires: String(fires + 1), last_fired: isoDate } };
}

export function fire(dir, name, isoDate) {
  const entry = readRuleFiles(dir).find((e) => e.rule.name === name);
  if (!entry) throw new Error(`rule not found: ${name}`);
  const updated = bumpFire(entry.rule, isoDate);
  fs.writeFileSync(path.join(dir, entry.file), serializeRule(updated));
  return updated;
}

const daysBetween = (fromIso, toIso) => (Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

// age signal: frontmatter modified, else created, else file mtime
function ageDate(rule, mtimeIso) {
  const declared = [rule.metadata.modified, rule.metadata.created].find((v) => ISO_DAY.test(v ?? ''));
  return declared ?? mtimeIso;
}

export function pruneReason(rule, { idleDays, today, mtimeIso }) {
  if (rule.metadata.fires === undefined) {
    return daysBetween(ageDate(rule, mtimeIso), today) > idleDays ? 'never-fired' : null;
  }
  const last = rule.metadata.last_fired;
  return last && daysBetween(last, today) > idleDays ? 'idle' : null;
}

export function prune(dir, { idleDays, today }) {
  return readRuleFiles(dir).flatMap(({ file, rule }) => {
    const mtimeIso = fs.statSync(path.join(dir, file)).mtime.toISOString().slice(0, 10);
    const reason = pruneReason(rule, { idleDays, today, mtimeIso });
    return reason ? [{ name: rule.name, reason }] : [];
  });
}

export const countEvidence = (body) => body.split('\n').filter((l) => EVIDENCE_LINE.test(l)).length;

export function evidenceCheck(dir, { max }) {
  return listRules(dir).flatMap((rule) => {
    const count = countEvidence(rule.body);
    return count > max ? [{ name: rule.name, count }] : [];
  });
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = rest[i + 1];
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function runCli(argv) {
  const { command, flags, positional } = parseArgs(argv);
  const dir = flags.dir;
  if (!dir) throw new Error('--dir is required');
  const date = flags.date ?? todayIso();
  const commands = {
    list: () => JSON.stringify(listRules(dir).map(({ top, ...rule }) => rule), null, 2),
    checklist: () => checklistMarkdown(dir).trimEnd(),
    fire: () => {
      const { top, ...rule } = fire(dir, positional[0], date);
      return JSON.stringify(rule, null, 2);
    },
    prune: () => JSON.stringify(prune(dir, { idleDays: Number(flags['idle-days'] ?? 60), today: date }), null, 2),
    'evidence-check': () => JSON.stringify(evidenceCheck(dir, { max: 3 }), null, 2),
  };
  const run = commands[command];
  if (!run) throw new Error(`usage: rule-store.mjs ${Object.keys(commands).join('|')} --dir <dir>`);
  return run();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(runCli(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
