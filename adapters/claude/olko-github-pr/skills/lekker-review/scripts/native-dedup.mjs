#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDedup } from './validate-lines.mjs'

const record = value => value && typeof value === 'object' && !Array.isArray(value)

export function deduplicateManifest(manifestPath) {
  const path = resolve(manifestPath)
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (!record(manifest) || !Array.isArray(manifest.dimensions) || manifest.dimensions.length === 0) {
    throw new Error('manifest must contain a non-empty dimensions array')
  }
  const dimensions = manifest.dimensions
  if (!dimensions.every(item => record(item) && typeof item.name === 'string' && item.name.trim()
      && item.name === item.name.trim() && typeof item.path === 'string' && item.path.trim()
      && item.path === item.path.trim())) throw new Error('each dimension requires a non-empty name and path')
  if (new Set(dimensions.map(item => item.name)).size !== dimensions.length) throw new Error('dimension names must be unique')
  const findings = dimensions.flatMap(({ name, path: resultPath }) => {
    const document = JSON.parse(readFileSync(resolve(dirname(path), resultPath), 'utf8'))
    if (!record(document) || !Array.isArray(document.findings) || document.findings.some(finding => !record(finding))) {
      throw new Error(`${name} result must contain a findings array of objects`)
    }
    return document.findings.map(finding => ({ ...finding, _dimension: name, agreedBy: [name] }))
  })
  return { findings: loadDedup()(findings) }
}

function main(args) {
  const [flag, manifestPath, ...extra] = args
  if (flag !== '--manifest' || !manifestPath || manifestPath.startsWith('--') || extra.length) {
    console.error('usage: native-dedup.mjs --manifest <manifest.json>')
    process.exitCode = 2
    return
  }
  try { console.log(JSON.stringify(deduplicateManifest(manifestPath))) } catch (error) {
    console.error(`native-dedup: ${error.message}`)
    process.exitCode = 2
  }
}

function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}

if (isMain()) main(process.argv.slice(2))
