#!/usr/bin/env node
import { openSync, readSync, closeSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { normalizeNativeResult } from './native-results.mjs'

try {
  const [dimension, input, output, ...extra] = process.argv.slice(2)
  if (!dimension || !input || extra.length) throw new Error('invalid arguments')
  const limit = 8 * 1024 * 1024, buffer = Buffer.alloc(limit + 1)
  const fd = openSync(input, 'r')
  let length = 0
  try {
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
  } finally { closeSync(fd) }
  if (length > limit) {
    console.log(JSON.stringify({ available: false, dimension, reason: 'raw reviewer result exceeds 8 MiB', document: null }))
    process.exit(1)
  }
  const raw = buffer.subarray(0, length)
  const result = normalizeNativeResult(dimension, JSON.parse(raw.toString('utf8')))
  if (result.available && output) writeFileSync(output, JSON.stringify(result.document), { flag: 'wx' })
  console.log(JSON.stringify({ ...result, rawSha256: createHash('sha256').update(raw).digest('hex') }))
  if (!result.available) process.exitCode = 1
} catch {
  console.log(JSON.stringify({ available: false, reason: 'raw reviewer result missing or malformed', document: null }))
  process.exitCode = 1
}
