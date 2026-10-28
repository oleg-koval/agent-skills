#!/usr/bin/env node
// Apply deterministic REVIEW.md path exclusions without allowing them to hide
// findings in files changed by the PR.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function reviewRules(projectRules) {
  const state = String(projectRules || '').split('\n').reduce((current, line) => {
    const header = line.match(/^===\s+(.+?)\s+===$/);
    if (header) {
      return { ...current, inReview: /(?:^|\/)REVIEW\.md$/i.test(header[1]), inIgnoreList: false };
    }
    if (!current.inReview) return current;
    if (!line.trim()) return current;

    const heading = /^#{1,6}\s*(?:paths?\s+to\s+ignore|ignore paths)\s*:?[ \t]*$/i.test(line);
    if (heading) return { ...current, inIgnoreList: true };
    if (/^\s*#{1,6}\s/.test(line)) return { ...current, inIgnoreList: false };

    const directive = line.match(/^\s*(?:[-*]\s*)?(?:paths?\s+to\s+ignore|ignore paths|ignore)\s*:\s*(.*?)\s*$/i);
    const listItem = current.inIgnoreList ? line.match(/^\s*[-*]\s+(.+?)\s*$/) : null;
    const text = directive ? directive[1] : listItem ? listItem[1] : '';
    const patterns = text.split(/[,;]/).map((part) => part.trim().replace(/^['"`]|['"`]$/g, ''))
      .filter((part) => part && !/[\u0000-\u001f\\]/.test(part) && !part.startsWith('/'));
    return {
      ...current,
      inIgnoreList: directive ? !directive[1] : Boolean(listItem && current.inIgnoreList),
      patterns: current.patterns.concat(patterns),
    };
  }, { inReview: false, inIgnoreList: false, patterns: [] });
  return state.patterns;
}

function normalizedPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function matchesGlob(file, pattern) {
  const safe = pattern.replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
  const directory = !/[*?]/.test(pattern);
  return new RegExp(`^${safe}${directory ? '(?:/.*)?' : ''}$`).test(file);
}

function shouldIgnore(item, patterns, changedPaths) {
  const file = normalizedPath(item.file);
  if (!file || changedPaths.has(file) || item.rule) return false;
  return patterns.some((pattern) => matchesGlob(file, pattern));
}

export function applyReviewRules(payload, context) {
  const patterns = reviewRules(context.projectRules);
  if (!Array.isArray(context.changedPaths)) return payload;
  const changedPaths = new Set(context.changedPaths.map(normalizedPath));
  const filter = (items) => Array.isArray(items)
    ? items.filter((item) => !shouldIgnore(item, patterns, changedPaths))
    : items;
  if (Array.isArray(payload)) return filter(payload);
  return {
    ...payload,
    findings: filter(payload.findings),
    preExisting: filter(payload.preExisting),
  };
}

function main(argv) {
  const [findingsPath, contextPath] = argv;
  if (!findingsPath || !contextPath) {
    console.error('usage: apply-review-rules.mjs <findings.json> <context.json>');
    process.exit(2);
  }
  const payload = JSON.parse(readFileSync(findingsPath, 'utf8'));
  const context = JSON.parse(readFileSync(contextPath, 'utf8'));
  const filtered = applyReviewRules(payload, context);
  const before = Array.isArray(payload) ? payload.length : (payload.findings || []).length;
  const after = Array.isArray(filtered) ? filtered.length : (filtered.findings || []).length;
  writeFileSync(findingsPath, `${JSON.stringify(filtered, null, 2)}\n`);
  if (before > after) console.log(`filtered ${before - after} finding(s) in ignored unchanged paths`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
