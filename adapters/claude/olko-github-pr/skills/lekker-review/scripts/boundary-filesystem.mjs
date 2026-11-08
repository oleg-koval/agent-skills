import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function observeComponentLimit(parentDir) {
  const probeDir = join(parentDir, 'limit-probe')
  mkdirSync(probeDir)
  const attempt = length => {
    const path = join(probeDir, 'x'.repeat(length))
    try { writeFileSync(path, ''); rmSync(path); return true } catch (error) {
      if (['ENAMETOOLONG', 'EINVAL'].includes(error.code)) return false
      throw error
    }
  }
  let low = 1, high = 1024
  if (attempt(high)) throw new Error('filesystem component limit exceeds bounded observation range')
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (attempt(middle)) low = middle
    else high = middle - 1
  }
  rmSync(probeDir, { recursive: true, force: true })
  return low
}
