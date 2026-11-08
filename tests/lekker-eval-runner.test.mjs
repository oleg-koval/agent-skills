import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { isHit, normalizeArchivedEvidence, parseKnownBug, score, validateArchiveRunIds, validateManifest } from '../plugins/olko-github-pr/skills/lekker-review/scripts/eval-runner.mjs'
import { scoreDefectCorpus } from '../plugins/olko-github-pr/skills/lekker-review/scripts/defect-scoring.mjs'

const manifestPath = 'plugins/olko-github-pr/skills/lekker-review/evals/manifest.json'
const manifest = {
  prs: [
    { repo: 'o/r', pr: 1, expect: 'buggy', knownBug: 'src/a.ts:42 drops last item' },
    { repo: 'o/r', pr: 2, expect: 'buggy', knownBug: 'src/b.ts:7 wrong key' },
    { repo: 'o/r', pr: 3, expect: 'clean' },
    { repo: 'o/r', pr: 4, expect: 'clean' },
  ],
}

test('the shipped manifest is valid and holds two placeholders', () => {
  const shipped = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(validateManifest(shipped).length, 2)
})

test('knownBug parsing and hit window', () => {
  assert.deepEqual(parseKnownBug('src/a.ts:42 desc'), { file: 'src/a.ts', line: 42 })
  assert.equal(parseKnownBug('no location'), null)
  assert.equal(isHit([{ file: 'src/a.ts', line: 50 }], 'src/a.ts:42 x'), true)
  assert.equal(isHit([{ file: 'src/a.ts', line: 60 }], 'src/a.ts:42 x'), false)
  assert.equal(isHit([{ file: 'src/other.ts', line: 42 }], 'src/a.ts:42 x'), false)
})

test('recall, false positives and unscored PRs', () => {
  const out = score(manifest, {
    'o/r#1': [{ file: 'src/a.ts', line: 41, severity: 'critical' }],
    'o/r#2': [{ file: 'src/c.ts', line: 1, severity: 'critical' }],
    'o/r#3': [{ severity: 'important' }, { severity: 'critical' }, { severity: 'observation' }],
  })
  assert.equal(out.recall, 0.5)
  assert.equal(out.falsePositives, 2)
  assert.equal(out.cleanScored, 1)
  assert.deepEqual(out.unscored, ['o/r#4'])
})

test('a malformed manifest is rejected', () => {
  assert.throws(() => validateManifest({ prs: [{ repo: 'o/r', pr: 1, expect: 'maybe' }] }), /expect/)
  assert.throws(() => validateManifest({}), /prs/)
})

test('defect scoring needs bound complete adjudication and separates unknown confirmations', () => {
  const manifest = { schema: 1, defects: [{ id: 'D1', contract: 'reproduce dropped item', reproductionEvidence: 'fixture assertion' }], cases: [
    { id: 'buggy', headSha: 'a'.repeat(40), expectedDefects: ['D1'], expectedRuns: 1 },
    { id: 'clean', headSha: 'b'.repeat(40), expectedDefects: [], expectedRuns: 1 },
  ] }
  const evaluation = (caseId, runId, headSha, decisions) => ({ findingsSha256: 'c'.repeat(64),
    run: { caseId, runId, headSha, status: 'completed', findings: decisions.map(() => ({ file: 'src/a.js', line: 1, severity: 'important' })) },
    adjudication: { runId, headSha, findingsSha256: 'c'.repeat(64), decisions } })
  const judgment = (findingIndex, verdict, defectId) => ({ findingIndex, verdict, defectId, rationale: 'adjudicator reviewed claim', evidence: 'review note' })
  const out = scoreDefectCorpus(manifest, [
    evaluation('buggy', 'run-1', 'a'.repeat(40), [
      judgment(0, 'confirmed', 'D1'), judgment(1, 'confirmed', 'new-defect'),
      judgment(2, 'false-alarm'), judgment(3, 'suggestion'), judgment(4, 'confirmed', 'D1'),
    ]),
    evaluation('clean', 'run-2', 'b'.repeat(40), []),
  ])
  assert.equal(out.available, false)
  assert.equal(out.needsAdjudication, true)
  assert.equal(out.recall, null)
  assert.equal(out.precision, 3 / 4)
  assert.equal(out.falseAlarms, 1)
  assert.equal(out.confirmedExpected, 1)
  assert.equal(out.confirmedClaims, 3)
  assert.equal(out.uniqueConfirmedDefects, 2)
  assert.equal(out.confirmedUnknown, 1)
  assert.equal(out.cleanAlarmRate, 0)
  assert.equal(scoreDefectCorpus(manifest, []).coverageComplete, false)
})

test('missing, duplicated, unresolved, or identity-mismatched adjudication cannot score clean', () => {
  const manifest = { schema: 1, defects: [], cases: [{ id: 'clean', headSha: 'a'.repeat(40), expectedDefects: [], expectedRuns: 1 }] }
  const run = { caseId: 'clean', runId: 'run', headSha: 'a'.repeat(40), status: 'completed', findings: [{ file: 'a.js', line: null, severity: 'observation' }] }
  const adjudication = { runId: 'run', headSha: run.headSha, findingsSha256: 'b'.repeat(64), decisions: [{ findingIndex: 0, verdict: 'unresolved', rationale: 'needs checking', evidence: 'none yet' }] }
  const scoreOne = (adj, hash = 'b'.repeat(64), actualRun = run) => scoreDefectCorpus(manifest, [{ run: actualRun, adjudication: adj, findingsSha256: hash }])
  assert.equal(scoreOne(null).available, false)
  assert.equal(scoreOne({ ...adjudication, runId: 'other' }).available, false)
  assert.equal(scoreOne(adjudication, 'c'.repeat(64)).available, false)
  assert.equal(scoreOne(adjudication, 'b'.repeat(64), { ...run, status: 'failed' }).available, false)
  assert.equal(scoreOne(adjudication, 'b'.repeat(64), { ...run, findings: [null] }).available, false)
  assert.equal(scoreOne({ ...adjudication, decisions: [{ ...adjudication.decisions[0] }, { ...adjudication.decisions[0], verdict: 'suggestion' }] }).available, false)
  assert.equal(scoreOne(adjudication).available, false)
  assert.equal(scoreOne(adjudication).precision, null)
})

test('defect CLI hashes raw findings bytes and keeps absent runs unavailable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-defect-cli-'))
  try {
    const write = (name, value) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(value)); return path }
    const bytes = '[{"file":"src/a.js","line":3,"severity":"important"}]'
    const hash = createHash('sha256').update(bytes).digest('hex')
    const manifest = { schema: 1, defects: [{ id: 'D1', contract: 'reproduces defect', reproductionEvidence: 'test case' }],
      cases: [{ id: 'case-1', headSha: 'a'.repeat(40), expectedDefects: ['D1'], expectedRuns: 1 }] }
    const results = { runs: [{ caseId: 'case-1', runId: 'run-1', status: 'completed', headSha: 'a'.repeat(40), findingsBytes: bytes }] }
    const adjudication = { evaluations: [{ runId: 'run-1', headSha: 'a'.repeat(40), findingsSha256: hash,
      decisions: [{ findingIndex: 0, verdict: 'confirmed', defectId: 'D1', rationale: 'matches contract', evidence: 'repro log' }] }] }
    const manifestPath = write('manifest.json', manifest), resultsPath = write('results.json', results)
    const adjudicationPath = write('adjudication.json', adjudication)
    const cli = 'plugins/olko-github-pr/skills/lekker-review/scripts/eval-runner.mjs'
    const run = () => spawnSync('node', [cli, '--defects', '--manifest', manifestPath, '--results', resultsPath,
      '--adjudication', adjudicationPath, '--json'], { encoding: 'utf8' })
    const valid = run()
    assert.equal(valid.status, 0, valid.stderr)
    assert.equal(JSON.parse(valid.stdout).recall, 1)
    write('results.json', { runs: [{ ...results.runs[0], findingsBytes: `${bytes} ` }] })
    const changedBytes = run()
    assert.equal(changedBytes.status, 1)
    const invalidHash = JSON.parse(changedBytes.stdout)
    assert.equal(invalidHash.available, false)
    assert.equal(invalidHash.rows[0].reason, 'finding bytes hash mismatch')
    write('results.json', { runs: [] })
    assert.equal(JSON.parse(run().stdout).coverageComplete, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('spaced paths, line 0 and null lines', () => {
  assert.deepEqual(parseKnownBug('src/my dir/a b.ts:42 desc'), { file: 'src/my dir/a b.ts', line: 42 })
  assert.equal(parseKnownBug('src/a.ts:0 desc'), null)
  assert.equal(isHit([{ file: 'src/a.ts', line: null }], 'src/a.ts:5 x'), false)
  assert.equal(isHit([{ file: 'src/a.ts', line: 0 }], 'src/a.ts:5 x'), false)
})

test('duplicate keys, missing knownBug and line 0 are rejected', () => {
  const dup = { prs: [{ repo: 'o/r', pr: 1, expect: 'clean' }, { repo: 'o/r', pr: 1, expect: 'clean' }] }
  assert.throws(() => validateManifest(dup), /duplicate/)
  assert.throws(() => validateManifest({ prs: [{ repo: 'o/r', pr: 1, expect: 'buggy' }] }), /knownBug/)
  assert.throws(() => validateManifest({ prs: [{ repo: 'o/r', pr: 1, expect: 'buggy', knownBug: 'a.ts:0 x' }] }), /knownBug/)
})

test('the same PR at two shas is accepted and keyed separately', () => {
  const m = { prs: [
    { repo: 'o/r', pr: 9, sha: 'aaaaaaa', expect: 'buggy', knownBug: 'src/a.ts:5 x' },
    { repo: 'o/r', pr: 9, sha: 'bbbbbbb', expect: 'clean' },
  ] }
  assert.equal(validateManifest(m).length, 2)
  const out = score(m, { 'o/r#9@aaaaaaa': [{ file: 'src/a.ts', line: 5 }], 'o/r#9@bbbbbbb': [] })
  assert.deepEqual(out.rows.map((r) => r.key), ['o/r#9@aaaaaaa', 'o/r#9@bbbbbbb'])
  assert.equal(out.recall, 1)
})

test('a duplicate id is rejected, an id overrides the repo#pr key', () => {
  const dup = { prs: [{ id: 'x', repo: 'o/r', pr: 1, expect: 'clean' }, { id: 'x', repo: 'o/r', pr: 2, expect: 'clean' }] }
  assert.throws(() => validateManifest(dup), /duplicate/)
  const out = score({ prs: [{ id: 'x', repo: 'o/r', pr: 1, expect: 'clean' }] }, { x: [] })
  assert.equal(out.cleanScored, 1)
})

test('multi-run scoring gives hitRate and per-run false positives', () => {
  const hit = [{ file: 'src/a.ts', line: 42 }]
  const out = score(manifest, {
    'o/r#1': [hit, hit, []],
    'o/r#2': [[{ file: 'src/b.ts', line: 7 }]],
    'o/r#3': [[{ severity: 'critical' }], [], [{ severity: 'important' }, { severity: 'important' }]],
  })
  const [r1, , r3] = out.rows
  assert.deepEqual([r1.runs, r1.hits, r1.hitRate], [3, 2, 2 / 3])
  assert.deepEqual(r3.falsePositivesPerRun, [1, 0, 2])
  assert.equal(out.recall, 3 / 4)
  assert.equal(out.buggyRuns, 4)
  assert.equal(out.falsePositives, 3)
  assert.equal(out.cleanRuns, 3)
  assert.equal(out.falsePositivesPerCleanRun, 1)
})

test('single-run output keeps today\'s exact shape', () => {
  const out = score(manifest, {
    'o/r#1': [{ file: 'src/a.ts', line: 41, severity: 'critical' }],
    'o/r#3': [{ severity: 'important' }],
  })
  assert.equal(JSON.stringify(out), JSON.stringify({
    recall: 1, buggyScored: 1, falsePositives: 1, cleanScored: 1, unscored: ['o/r#2', 'o/r#4'],
    rows: [
      { key: 'o/r#1', expect: 'buggy', scored: true, hit: true },
      { key: 'o/r#2', expect: 'buggy', scored: false },
      { key: 'o/r#3', expect: 'clean', scored: true, falsePositives: 1 },
      { key: 'o/r#4', expect: 'clean', scored: false },
    ],
  }))
})

test('a mixed results file scores single and multi cases together', () => {
  const hit = [{ file: 'src/a.ts', line: 42 }]
  const out = score(manifest, {
    'o/r#1': [hit, []],
    'o/r#2': [{ file: 'src/b.ts', line: 7 }],
    'o/r#3': [{ severity: 'critical' }],
  })
  assert.equal(out.recall, 2 / 3)
  assert.equal(out.buggyRuns, 3)
  assert.equal(out.falsePositives, 1)
  assert.equal(out.rows[1].hit, true)
  assert.equal(out.rows[1].runs, undefined)
})

test('an unusable id or sha is rejected instead of falling back to repo#pr', () => {
  const one = (extra) => ({ prs: [{ repo: 'o/r', pr: 1, expect: 'clean', ...extra }] })
  assert.throws(() => validateManifest(one({ id: 7 })), /id must be/)
  assert.throws(() => validateManifest(one({ id: '' })), /id must be/)
  assert.throws(() => validateManifest(one({ sha: 'main' })), /sha must be/)
  assert.throws(() => validateManifest(one({ sha: 'abc' })), /sha must be/)
  assert.equal(validateManifest(one({ sha: 'ABCDEF0' })).length, 1)
})

test('the CLI summary names run counts when a case has repeated runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-eval-'))
  const write = (name, value) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p }
  const run = (results) => execFileSync('node', [
    'plugins/olko-github-pr/skills/lekker-review/scripts/eval-runner.mjs',
    '--manifest', write('m.json', manifest), '--results', write('r.json', results),
  ], { encoding: 'utf8' }).trim()
  const hit = [{ file: 'src/a.ts', line: 42 }]
  assert.equal(run({ 'o/r#1': hit, 'o/r#3': [] }),
    'recall 100% (1 buggy scored), false positives 0 (1 clean scored), unscored 2')
  assert.equal(run({ 'o/r#1': [hit, []], 'o/r#3': [[{ severity: 'critical' }], []] }),
    'recall 50% per run (2 runs over 1 buggy cases), false positives 1 (2 runs over 1 clean cases, 0.50 per run), unscored 2')
})

test('archive CLI scores valid runs and leaves incomplete or unsafe runs unscored', /** Covers accepted evidence and stable reasons for every rejected archive. */ () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-eval-archive-'))
  try {
    const sha = 'A'.repeat(40)
    const runId = 'verified-run'
    const runDir = join(dir, runId)
    mkdirSync(runDir)
    const save = (name, value) => writeFileSync(join(runDir, name), JSON.stringify(value))
    save('run.json', { runId, status: 'ok', verdict: 'lgtm-with-changes', repo: 'o/r', target: 'pr-9',
      review: { name: 'lekker-review-core', status: 'completed' } })
    save('worktree.json', { headSha: sha.toLowerCase() })
    save('findings.json', { findings: [{ file: 'src/a.ts', line: 42, severity: 'important' }] })
    const cleanDir = join(dir, 'verified-clean')
    mkdirSync(cleanDir)
    writeFileSync(join(cleanDir, 'run.json'), JSON.stringify({ runId: 'verified-clean', status: 'ok', verdict: 'lgtm', repo: 'o/r', target: 'pr-10',
      review: { name: 'lekker-review-core', status: 'completed' } }))
    writeFileSync(join(cleanDir, 'worktree.json'), JSON.stringify({ headSha: 'b'.repeat(40) }))
    writeFileSync(join(cleanDir, 'findings.json'), JSON.stringify({ findings: [{ file: 'src/b.ts', line: null, severity: 'observation' }] }))
    for (const [id, pr, status, headSha] of [
      ['failed-run', 13, 'failed', 'e'.repeat(40)],
      ['mismatched-head', 14, 'ok', 'f'.repeat(40)],
    ]) {
      const invalidDir = join(dir, id)
      mkdirSync(invalidDir)
      writeFileSync(join(invalidDir, 'run.json'), JSON.stringify({ runId: id, status, verdict: 'lgtm', repo: 'o/r', target: `pr-${pr}`,
        review: { name: 'lekker-review-core', status: 'completed' } }))
      writeFileSync(join(invalidDir, 'worktree.json'), JSON.stringify({ headSha }))
      writeFileSync(join(invalidDir, 'findings.json'), JSON.stringify({ findings: [] }))
    }
    const cases = { prs: [
      { repo: 'o/r', pr: 9, sha, runId, expect: 'buggy', knownBug: 'src/a.ts:42 known issue' },
      { repo: 'o/r', pr: 10, sha: 'b'.repeat(40), runId: 'verified-clean', expect: 'clean' },
      { repo: 'o/r', pr: 11, sha: 'c'.repeat(40), runId: 'missing-run', expect: 'clean' },
      { repo: 'o/r', pr: 12, sha: 'd'.repeat(40), runId: '../escape', expect: 'clean' },
      { repo: 'o/r', pr: 13, sha: 'e'.repeat(40), runId: 'failed-run', expect: 'clean' },
      { repo: 'o/r', pr: 14, sha: 'a'.repeat(40), runId: 'mismatched-head', expect: 'clean' },
    ] }
    const manifestFile = join(dir, 'manifest.json')
    writeFileSync(manifestFile, JSON.stringify(cases))
    const cli = 'plugins/olko-github-pr/skills/lekker-review/scripts/eval-runner.mjs'
    const result = spawnSync('node', [cli, '--manifest', manifestFile, '--archive', dir, '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const out = JSON.parse(result.stdout)
    assert.equal(out.recall, 1)
    assert.equal(out.cleanScored, 1)
    assert.equal(out.falsePositives, 0)
    assert.deepEqual(out.rows.filter((row) => !row.scored).map((row) => row.key), [
      'o/r#11@' + 'c'.repeat(40), 'o/r#12@' + 'd'.repeat(40),
      'o/r#13@' + 'e'.repeat(40), 'o/r#14@' + 'a'.repeat(40),
    ])
    assert.deepEqual(out.unscoredReasons.map((item) => item.reason), [
      'run.json missing or malformed', 'unsafe or missing runId', 'run status is not ok', 'worktree headSha mismatch',
    ])
    const human = spawnSync('node', [cli, '--manifest', manifestFile, '--archive', dir], { encoding: 'utf8' })
    assert.match(human.stderr, /legacy heuristic mode/)
    assert.match(human.stderr, /run\.json missing or malformed/)
    assert.match(human.stderr, /unsafe or missing runId/)
    assert.match(human.stderr, /run status is not ok/)
    assert.match(human.stderr, /worktree headSha mismatch/)
    for (const args of [['--archive'], ['--archive', '--json'], ['--results'], ['--results', '--json'], ['--archive', dir, '--results']]) {
      const missingArchive = spawnSync('node', [cli, '--manifest', manifestFile, ...args], { encoding: 'utf8' })
      assert.equal(missingArchive.status, 2)
      assert.match(missingArchive.stderr, /usage: eval-runner\.mjs/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('archive evidence normalization preserves only complete, matching evidence', () => {
  const entry = { repo: 'o/r', pr: 9, sha: 'A'.repeat(40), runId: 'run', expect: 'clean' }
  const run = { runId: 'run', status: 'ok', verdict: 'lgtm', repo: 'o/r', target: 'pr-9', review: { name: 'lekker-review-core', status: 'completed' } }
  const worktree = { headSha: entry.sha.toLowerCase() }
  const finding = { file: 'src/a.ts', line: null, severity: 'observation' }
  assert.deepEqual(normalizeArchivedEvidence(entry, run, worktree, { findings: [finding] }), {
    key: 'o/r#9@' + entry.sha, findings: [finding], reason: null,
  })
  assert.equal(normalizeArchivedEvidence(entry, { ...run, runId: 'other' }, worktree, { findings: [] }).reason, 'runId mismatch')
  assert.equal(normalizeArchivedEvidence({ ...entry, sha: [entry.sha] }, run, worktree, { findings: [] }).reason, 'manifest needs a full 40-character sha')
  assert.equal(normalizeArchivedEvidence(entry, run, worktree, { findings: [{ file: ' ', line: 0, severity: 'important' }] }).reason, 'findings.json contains a malformed finding')
  const longId = 'r'.repeat(140)
  assert.equal(normalizeArchivedEvidence({ ...entry, runId: longId }, { ...run, runId: longId }, worktree, []).reason, null)
  assert.throws(() => validateArchiveRunIds([{ runId: 'same' }, { runId: 'same' }]), /reuses runId/)
})
