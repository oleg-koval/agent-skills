#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { normalizeNativeResult } from './native-results.mjs'

try {
  const [dimension, input] = process.argv.slice(2)
  const raw = readFileSync(input)
  const result = normalizeNativeResult(dimension, JSON.parse(raw.toString('utf8')))
  console.log(JSON.stringify({ ...result, rawSha256: createHash('sha256').update(raw).digest('hex') }))
  if (!result.available) process.exitCode = 1
} catch {
  console.log(JSON.stringify({ available: false, reason: 'raw reviewer result missing or malformed', document: null }))
  process.exitCode = 1
}
