#!/usr/bin/env node
// Validates that every Markdown file's YAML frontmatter is well-formed.
// Run: node .github/scripts/check-frontmatter.mjs [dir]
// Self-test: node .github/scripts/check-frontmatter.mjs --test
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git'])

/**
 * Parses YAML frontmatter from markdown content.
 * Returns {ok:true, fields} | {ok:false, reason} | {ok:true, fields:null} when
 * the file legitimately has no frontmatter.
 */
export function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { ok: true, fields: null }

  const afterOpen = content.indexOf('\n')
  if (afterOpen === -1) return { ok: false, reason: 'opening --- has no newline' }
  if (content.slice(0, afterOpen).trim() !== '---') {
    return { ok: true, fields: null }
  }

  const rest = content.slice(afterOpen + 1)
  const closeMatch = rest.match(/^---[ \t]*$/m)
  if (!closeMatch) return { ok: false, reason: 'frontmatter block is not closed' }

  const block = rest.slice(0, closeMatch.index)
  if (/^\t/m.test(block)) {
    return { ok: false, reason: 'frontmatter uses tab indentation, which YAML forbids' }
  }

  const fields = {}
  const lines = block.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (/^\s/.test(line)) continue // nested value, belongs to the previous key
    if (line.trimStart().startsWith('- ')) continue // list item
    const colon = line.indexOf(':')
    if (colon === -1) {
      return { ok: false, reason: `line ${i + 1} is not a key/value pair: ${line}` }
    }
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return { ok: true, fields }
}

/**
 * Recursively walks a directory tree to find all markdown files.
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(join(dir, entry.name), out)
    } else if (entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

/**
 * Runs self-tests to verify frontmatter parsing logic.
 */
function runTests() {
  const cases = [
    ['no frontmatter', '# Title\n', true],
    ['valid', '---\nname: x\n---\nbody\n', true],
    ['closed at EOF without trailing newline', '---\nname: x\n---', true],
    ['unclosed', '---\nname: x\nbody\n', false],
    ['tab indented', '---\nmetadata:\n\ttags: [a]\n---\n', false],
    ['--- in body is not frontmatter', '# T\n\n---\n\nmore\n', true],
    ['nested mapping', '---\nmetadata:\n  tags:\n    - a\n---\n', true],
    ['non pair line', '---\nname x\n---\n', false],
  ]
  let failed = 0
  for (const [label, input, expectOk] of cases) {
    const got = parseFrontmatter(input).ok
    if (got !== expectOk) {
      console.error(`FAIL ${label}: expected ok=${expectOk}, got ${got}`)
      failed++
    }
  }
  if (failed > 0) {
    console.error(`${failed} self-test(s) failed`)
    process.exit(1)
  }
  console.log(`${cases.length} self-tests passed`)
}

const arg = process.argv[2]
if (arg === '--test') {
  runTests()
} else {
  const root = arg || '.'
  const bad = []
  for (const file of walk(root)) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const result = parseFrontmatter(content)
    if (!result.ok) bad.push(`${file}: ${result.reason}`)
  }
  if (bad.length > 0) {
    console.error('Malformed frontmatter:')
    for (const line of bad) console.error(`  ${line}`)
    process.exit(1)
  }
  console.log('frontmatter OK')
}
