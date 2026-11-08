import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(value).digest('hex')
const bytes = value => Buffer.byteLength(value, 'utf8')
const alphabets = Object.freeze({ ascii: 'abcdefghijklmnopqrstuvwxyz0123456789', multibyte: '界é🙂' })

function fill(length, alphabet, seed, index) {
  const chars = [...alphabet]
  return Array.from({ length }, (_, offset) => {
    const value = createHash('sha256').update(`${seed}:${index}:${offset}`).digest().readUInt32BE(0)
    return chars[value % chars.length]
  }).join('')
}

export function fitComponent(prefix, body, suffix, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('component limit must be a nonnegative integer')
  const room = limit - bytes(prefix) - bytes(suffix)
  if (room < 0) return { status: 'rejected', value: null, bytes: bytes(prefix) + bytes(suffix) }
  const chars = [...body]
  const firstOverflow = chars.findIndex((char, index) => bytes(chars.slice(0, index + 1).join('')) > room)
  const kept = chars.slice(0, firstOverflow < 0 ? chars.length : firstOverflow).join('')
  const value = prefix + kept + suffix
  return { status: bytes(value) <= limit ? 'available' : 'rejected', value: bytes(value) <= limit ? value : null, bytes: bytes(value) }
}

export function generateBoundaryCases({ seed, limit, prefix = '', suffix = '', count = 32, kinds = ['ascii', 'multibyte'] }) {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new Error('seed, positive limit, and count from 1 to 100 are required')
  }
  const room = Math.max(0, limit - bytes(prefix) - bytes(suffix))
  const lengths = [...new Set([0, 1, Math.max(0, room - 1), room, room + 1, Math.max(0, room - 6), room + 6])]
  if (!Array.isArray(kinds) || kinds.length === 0 || kinds.some(kind => !(kind in alphabets))) throw new Error('known case kinds are required')
  return Array.from({ length: count }, (_, index) => {
    const kind = kinds[index % kinds.length]
    const alphabet = alphabets[kind]
    const size = lengths[index % lengths.length]
    const body = fill(size, alphabet, seed, index)
    const input = body + suffix
    const fitted = fitComponent(prefix, body, suffix, limit)
    return Object.freeze({ id: `${kind}-${index}`, kind, input, component: fitted.value,
      inputSha256: hash(input), componentSha256: fitted.value === null ? null : hash(fitted.value),
      inputBytes: bytes(input), outputBytes: fitted.bytes, status: fitted.status, limit })
  })
}
