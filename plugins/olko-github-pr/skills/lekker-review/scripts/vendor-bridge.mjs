#!/usr/bin/env node
// Runs one read-only gate agent on the other vendor's CLI and returns schema-checked JSON.
//
//   node vendor-bridge.mjs --to codex|claude --model <m> --effort <e>
//     --schema <schema.json> --prompt <prompt.md> --cwd <dir> --out <result.json>
//     [--timeout <seconds>]
//
// Exit 0: validated JSON is in --out. Exit 3: --out holds {"fallback": "<reason>"}
// and the caller reruns the agent on its own vendor. Exit 2: unusable arguments.
// The prompt travels by stdin and every process gets an argument array, so
// nothing from the prompt, schema or paths is ever parsed by a shell.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { text } from 'node:stream/consumers'
import { pathToFileURL } from 'node:url'

export const FALLBACK_EXIT = 3
export const TARGETS = ['codex', 'claude']
const DEFAULT_TIMEOUT_SECONDS = 600

const REQUIRED = ['to', 'model', 'effort', 'schema', 'prompt', 'cwd', 'out']

export function parseArgs(argv) {
  const pairs = argv.reduce((acc, token, i) =>
    token.startsWith('--') && i + 1 < argv.length ? { ...acc, [token.slice(2)]: argv[i + 1] } : acc, {})
  const timeout = pairs.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(pairs.timeout)
  const missing = REQUIRED.filter(key => !pairs[key])
  if (missing.length > 0) return { error: `missing ${missing.map(k => `--${k}`).join(', ')}` }
  if (!TARGETS.includes(pairs.to)) return { error: `--to must be one of ${TARGETS.join(', ')}` }
  if (!(timeout > 0)) return { error: '--timeout must be a positive number of seconds' }
  return { options: { ...Object.fromEntries(REQUIRED.map(k => [k, pairs[k]])), timeout } }
}

const typeMatches = (type, value) => ({
  object: v => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray,
  string: v => typeof v === 'string',
  integer: Number.isInteger,
  number: v => typeof v === 'number',
  boolean: v => typeof v === 'boolean',
}[type]?.(value) ?? true)

// The subset of JSON Schema the lekker gate schemas use. Unknown keywords pass,
// so a stricter schema is still enforced by the vendor CLI itself.
export function validate(schema, value, path = '$') {
  if (schema.type !== undefined && !typeMatches(schema.type, value)) return [`${path} is not ${schema.type}`]
  if (schema.enum && !schema.enum.includes(value)) return [`${path} is not one of ${schema.enum.join('|')}`]
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    return [`${path} is shorter than ${schema.minLength}`]
  }
  if (Array.isArray(value) && schema.items) {
    return value.flatMap((item, i) => validate(schema.items, item, `${path}[${i}]`))
  }
  if (!typeMatches('object', value)) return []
  const absent = (schema.required ?? []).filter(key => !(key in value)).map(key => `${path}.${key} is required`)
  const nested = Object.entries(schema.properties ?? {})
    .filter(([key]) => key in value)
    .flatMap(([key, sub]) => validate(sub, value[key], `${path}.${key}`))
  return [...absent, ...nested]
}

// Codex strict structured output rejects schemas with optional properties, which
// every lekker schema has, so Codex gets the schema in the prompt and the bridge
// validates its answer instead of passing --output-schema.
export function promptFor(to, prompt, schemaText) {
  return to === 'codex'
    ? `${prompt}\n\nReply with only one JSON value, no prose and no code fence, that matches this JSON Schema:\n${schemaText}\n`
    : prompt
}

// Fix verifiers judge the real `git diff`, so the Claude target may run
// read-only git; in print mode every tool outside this list is denied.
const CLAUDE_READ_ONLY_TOOLS = 'Read,Grep,Glob,Bash(git diff:*),Bash(git show:*),Bash(git log:*),Bash(git status:*)'

export function commandFor({ to, model, effort, schemaText, rawOut, cwd }) {
  return to === 'codex'
    ? { cmd: 'codex', args: ['exec', '-m', model, '-c', `model_reasoning_effort=${effort}`, '-s', 'read-only',
        '--skip-git-repo-check', '-o', rawOut, '-C', cwd, '-'] }
    : { cmd: 'claude', args: ['-p', '--model', model, '--effort', effort, '--output-format', 'json',
        '--json-schema', schemaText, '--permission-mode', 'default',
        '--allowedTools', CLAUDE_READ_ONLY_TOOLS, '--disallowedTools', 'Edit,Write,NotebookEdit'] }
}

const parseJson = raw => {
  try { return { value: JSON.parse(raw) } } catch { return { error: 'output is not valid JSON' } }
}

const unfence = raw => raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1')

// `to` names the CLI that ran: codex leaves its last message in a file, claude prints an envelope.
export function resultFrom(to, { stdout, rawOutText }) {
  if (to === 'codex') return parseJson(unfence(rawOutText ?? ''))
  const envelope = parseJson(stdout)
  if (envelope.error || !typeMatches('object', envelope.value)) return { error: 'claude output is not a JSON envelope' }
  const { is_error: isError, structured_output: structured, result } = envelope.value
  if (isError) return { error: `claude reported an error: ${String(result).slice(0, 200)}` }
  return structured !== undefined && structured !== null ? { value: structured } : parseJson(unfence(String(result ?? '')))
}

function writeAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const staging = `${path}.tmp`
  writeFileSync(staging, `${JSON.stringify(value)}\n`)
  renameSync(staging, path)
}

function runProcess(cmd, args, { stdin, cwd, timeoutMs }) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = text(child.stdout).catch(() => '')
    const stderr = text(child.stderr).catch(() => '')
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ reason: `timed out after ${timeoutMs / 1000}s` })
    }, timeoutMs)
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ reason: error.code === 'ENOENT' ? `${cmd} not found on PATH` : `${cmd} failed to start: ${error.message}` })
    })
    child.on('close', async code => {
      clearTimeout(timer)
      resolve({ code, stdout: await stdout, stderr: await stderr })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}

const firstLine = raw => String(raw ?? '').trim().split('\n')[0].slice(0, 200)

function readInputs(promptPath, schemaPath) {
  try {
    return { prompt: readFileSync(promptPath, 'utf8'), schemaText: readFileSync(schemaPath, 'utf8').trim() }
  } catch (error) {
    return { error: firstLine(error.message) }
  }
}

async function runVendor(options) {
  const { to, model, effort, schema, prompt, cwd, timeout, out } = options
  const inputs = readInputs(prompt, schema)
  if (inputs.error) return { fallback: `cannot read prompt or schema: ${inputs.error}` }
  const schemaValue = parseJson(inputs.schemaText)
  if (schemaValue.error) return { fallback: 'schema file is not valid JSON' }

  const rawOut = `${out}.raw`
  rmSync(rawOut, { force: true })
  const { cmd, args } = commandFor({ to, model, effort, schemaText: inputs.schemaText, rawOut, cwd })
  const ran = await runProcess(cmd, args, { stdin: promptFor(to, inputs.prompt, inputs.schemaText), cwd, timeoutMs: timeout * 1000 })
  if (ran.reason) return { fallback: ran.reason }
  if (ran.code !== 0) return { fallback: `${cmd} exited ${ran.code}: ${firstLine(ran.stderr)}` }

  const rawOutText = existsSync(rawOut) ? readFileSync(rawOut, 'utf8') : undefined
  const parsed = resultFrom(to, { stdout: ran.stdout, rawOutText })
  if (parsed.error) return { fallback: parsed.error }
  const problems = validate(schemaValue.value, parsed.value)
  return problems.length > 0 ? { fallback: `schema mismatch: ${problems[0]}` } : { value: parsed.value }
}

async function main(argv) {
  const { options, error } = parseArgs(argv)
  if (error) {
    console.error(`vendor-bridge: ${error}`)
    process.exit(2)
  }
  const outcome = await runVendor(options)
  const failed = outcome.fallback !== undefined
  writeAtomic(options.out, failed ? { fallback: outcome.fallback } : outcome.value)
  if (failed) console.error(`vendor-bridge: fallback: ${outcome.fallback}`)
  process.exit(failed ? FALLBACK_EXIT : 0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
