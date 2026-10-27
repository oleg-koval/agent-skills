import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  scoreLedger,
  summaryMarkdown,
  validateLedger,
} from '../plugins/olko-reflection/skills/self-critique/scripts/claim-ledger.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const SKILL = join(here, '../plugins/olko-reflection/skills/self-critique/SKILL.md')
const FIXTURES = join(here, 'fixtures/self-critique')
const SHARED_WORDS = new Set(['handler'])

export const extractCriticTemplate = (skillText) => {
  const lines = skillText.split('\n')
  const start = lines.findIndex((l) => l.trim() === '## Critic prompt template')
  if (start === -1) throw new Error('critic template heading not found')
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('#'))
  const body = end === -1 ? rest : rest.slice(0, end)
  return body
    .filter((l) => l.startsWith('>'))
    .map((l) => l.replace(/^>\s?/, ''))
    .join('\n')
}

export const buildPrompt = (template, task, answer) =>
  [
    template.replace('{{TASK}}', () => task.trim()).replace('{{ANSWER}}', () => answer.trim()),
    '',
    'You may read files under the added directory to verify. End your reply with the single fenced json block described above.',
  ].join('\n')

export const parseCriticJson = (stdoutText) => {
  const blocks = [...stdoutText.matchAll(/```json\s*\n([\s\S]*?)\n\s*```/g)]
  const last = blocks.at(-1)
  if (!last) throw new Error('no fenced json block in critic output')
  return JSON.parse(last[1])
}

export const authorClaims = (answerText) =>
  answerText
    .split('\n')
    .map((l) => /^\d+\.\s+(.*)$/.exec(l))
    .filter((m) => m !== null)
    .map((m, i) => ({ id: `a${i + 1}`, text: m[1], load_bearing: true }))

const keywords = (text) =>
  new Set((text.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !SHARED_WORDS.has(w)))

const shares = (a, b) => [...keywords(a)].some((w) => keywords(b).has(w))

const checkedBy = (c) => c.checked_by ?? 'inferred'

const claimStatus = (c) => (c.status === 'refuted' && checkedBy(c) === 'inferred' ? 'inferred' : c.status)

const criticClaim = (authors) => (c, i) => ({
  id: `c${i + 1}`,
  text: c.text,
  load_bearing: c.load_bearing,
  origin: authors.some((a) => shares(a.text, c.text)) ? 'both' : 'critic',
  status: claimStatus(c),
  checked_by: checkedBy(c),
  receipt: c.receipt ?? '',
})

const authorOnly = (a) => ({
  id: a.id,
  text: a.text,
  load_bearing: a.load_bearing,
  origin: 'author',
  status: 'unverifiable',
  checked_by: 'inferred',
  receipt: 'critic did not address this claim',
})

export const toLedger = (criticOutput, authors) => {
  const claims = (criticOutput.claims ?? []).map(criticClaim(authors))
  const unmatched = authors.filter((a) => !claims.some((c) => shares(a.text, c.text)))
  const missed = (criticOutput.missed ?? []).map((m, i) => ({
    id: `m${i + 1}`,
    text: m.text,
    load_bearing: m.load_bearing,
    checked_by: checkedBy(m),
  }))
  return { version: 1, claims: [...claims, ...unmatched.map(authorOnly)], missed }
}

const mentions = (texts, word) => texts.some((t) => t.toLowerCase().includes(word.toLowerCase()))

const ruleC = (ledger, expected) => {
  const refuted = ledger.claims.filter((c) => c.status === 'refuted').map((c) => c.text)
  const missed = ledger.missed.map((m) => m.text)
  return (
    expected.seeded.must_refute.every((w) => mentions(refuted, w)) &&
    expected.seeded.must_miss.every((w) => mentions(missed, w))
  )
}

export const assertExpectations = ({ correctScore, seededScore, seededLedger, expected }) =>
  [
    correctScore >= expected.correct.min_round1_score ? null : 'A',
    seededScore <= expected.seeded.max_round1_score ? null : 'B',
    ruleC(seededLedger, expected) ? null : 'C',
  ].filter((x) => x !== null)

const runClaude = (prompt, dir) => {
  const r = spawnSync(
    'claude',
    ['-p', '--output-format', 'json', '--model', 'sonnet', '--allowedTools', 'Read,Grep,Glob,Bash(node:*)', '--add-dir', dir],
    { input: prompt, encoding: 'utf8', cwd: dir, maxBuffer: 64 * 1024 * 1024 },
  )
  if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${r.stderr}`)
  return JSON.parse(r.stdout).result
}

const critique = (name, template) => {
  const dir = mkdtempSync(join(tmpdir(), `self-critique-${name}-`))
  cpSync(join(FIXTURES, 'repo'), join(dir, 'repo'), { recursive: true })
  const task = readFileSync(join(FIXTURES, 'task.md'), 'utf8')
  const answer = readFileSync(join(FIXTURES, `answer-${name}.md`), 'utf8')
  const output = parseCriticJson(runClaude(buildPrompt(template, task, answer), dir))
  const ledger = toLedger(output, authorClaims(answer))
  const errors = validateLedger(ledger)
  if (errors.length > 0) throw new Error(`${name} ledger invalid: ${errors.join('; ')}`)
  return { ledger, score: scoreLedger(ledger).score }
}

const main = () => {
  const template = extractCriticTemplate(readFileSync(SKILL, 'utf8'))
  const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8'))
  const correct = critique('correct', template)
  const seeded = critique('seeded', template)
  const failed = assertExpectations({
    correctScore: correct.score,
    seededScore: seeded.score,
    seededLedger: seeded.ledger,
    expected,
  })
  console.log(`correct: ${correct.score}\n${summaryMarkdown(correct.ledger)}`)
  console.log(`seeded: ${seeded.score}\n${summaryMarkdown(seeded.ledger)}`)
  const dir = join(here, '.artifacts')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `self-critique-e2e-${new Date().toISOString().slice(0, 10)}.json`)
  writeFileSync(file, `${JSON.stringify({ correct, seeded, failed }, null, 2)}\n`)
  console.log(`receipt: ${file}`)
  if (failed.length > 0) {
    console.error(`failed assertions: ${failed.join(', ')}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
