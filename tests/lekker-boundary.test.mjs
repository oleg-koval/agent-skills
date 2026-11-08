import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runBoundaryProbe } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-probe-runner.mjs'
import { collectEvidence } from '../plugins/olko-github-pr/skills/lekker-review/scripts/evidence-bundle.mjs'
import { validateBoundaryReport } from '../plugins/olko-github-pr/skills/lekker-review/scripts/boundary-validation.mjs'
import { collectGitEvidence } from '../plugins/olko-github-pr/skills/lekker-review/scripts/git-evidence.mjs'

const SOURCE = 'plugins/olko-github-pr/skills/lekker-review/scripts/run-log.mjs'
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

function compatibleCli(mode) {
  const addedSuffix = mode !== 'original'
  const capped = mode === 'repaired'
  return `import { mkdirSync, mkdtempSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
const argv = process.argv.slice(2);
const flag = name => argv[argv.indexOf(name) + 1];
const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (argv[0] !== 'start' || !flag('--repo') || !flag('--target')) process.exit(2);
if (${mode === 'reject'}) process.exit(2);
if (${mode === 'signal'}) process.kill(process.pid, 'SIGTERM');
const repo = flag('--repo'), target = flag('--target');
const name = ${mode === 'hashed' ? 'createHash("sha256").update(target).digest("hex")' : 'slug(target)'};
const fullPrefix = '20261108123456Z'.slice(0, 15) + '-' + slug(basename(repo)) + '-' + name${addedSuffix ? " + '-'" : ''};
const prefix = ${capped ? 'fullPrefix.slice(0, 249)' : 'fullPrefix'};
const root = join(process.env.LEKKER_STATE_DIR, 'runs'); mkdirSync(root, { recursive: true });
const path = ${addedSuffix ? 'mkdtempSync(join(root, prefix))' : 'join(root, prefix)'};
mkdirSync(path, { recursive: true }); process.stdout.write(JSON.stringify({ runId: basename(path) }));
`
}

function cliHistory(t, sourcePath = SOURCE) {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-boundary-')), repo = join(dir, 'trusted')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(repo); git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Boundary Test')
  git(repo, 'config', 'user.email', 'boundary@example.invalid'); git(repo, 'config', 'core.hooksPath', '/dev/null')
  const writeSource = mode => { mkdirSync(join(repo, sourcePath, '..'), { recursive: true }); writeFileSync(join(repo, sourcePath), compatibleCli(mode)) }
  const commit = message => { git(repo, 'add', '-A'); git(repo, 'commit', '-qm', message); return git(repo, 'rev-parse', 'HEAD') }
  writeSource('original'); const base = commit('original CLI')
  writeSource('defective'); const head = commit('defective CLI')
  git(repo, 'checkout', '-q', base); writeSource('repaired'); const repaired = commit('repaired CLI')
  git(repo, 'checkout', '-q', base); writeSource('hashed'); const hashedHead = commit('hashed CLI')
  git(repo, 'checkout', '-q', base); writeSource('reject'); const unexpectedHead = commit('unexpected CLI exit')
  git(repo, 'checkout', '-q', base); writeSource('signal'); const signalHead = commit('signalled CLI')
  git(repo, 'checkout', '-q', base); writeFileSync(join(repo, 'unrelated.txt'), 'unrelated\n'); const unchangedPathHead = commit('unrelated change')
  git(repo, 'checkout', '-q', head)
  return { dir, repo, base, head, repaired, hashedHead, unexpectedHead, signalHead, unchangedPathHead }
}

test('trusted adapter composes fixed run-log CLI contract and reduces a defect case', t => {
  const fixture = cliHistory(t), outputDir = join(fixture.dir, 'probe')
  const config = { schema: 1, trustedRoot: fixture.repo, repoSlug: 'r', seed: 19, maxInputs: 8, repairedCommit: fixture.repaired }
  const result = runBoundaryProbe({ config, worktreePath: fixture.repo, mergeBase: fixture.base,
    headSha: fixture.head, outputDir, optIn: true })
  assert.equal(result.status, 'available', result.reason)
  assert.ok(result.contract.maxComponentBytes > 32)
  assert.ok(result.candidates.length > 0, JSON.stringify(result.results.map(row => ({ id: row.id, bytes: row.inputBytes,
    statuses: Object.fromEntries(Object.entries(row.runs).map(([role, run]) => [role, [run.status, run.exitCode, run.errorCode,
      readFileSync(join(outputDir, run.stderrFile), 'utf8')]])) }))))
  assert.deepEqual(result.candidates[0].outcomes, { original: 0, defective: 1, repaired: 0 })
  assert.match(result.reducedCounterexample.scope, /not a proof of global minimality/)
  const rawPath = result.results.find(row => row.runs.defective.exitCode === 1).runs.defective.stderrFile
  const raw = readFileSync(join(outputDir, rawPath), 'utf8')
  assert.match(raw, /ENAMETOOLONG/)
  assert.match(readFileSync(result.reportFile, 'utf8'), /"generatorSha256"/)
  assert.equal(result.provenance.sources.defective.sha256,
    createHash('sha256').update(readFileSync(join(fixture.repo, SOURCE))).digest('hex'))
  const observedGit = collectGitEvidence({ worktreePath: fixture.repo, mergeBase: fixture.base, headSha: fixture.head })
  const validated = validateBoundaryReport(result, observedGit)
  assert.equal(validated.captureStatus, 'available', validated.reason)
  const reducedRun = result.results.find(row => row.id === result.reducedCounterexample.id).runs.defective
  assert.deepEqual(validated.summary.reducedFailure, { caseId: result.reducedCounterexample.id,
    exitClass: 'component-limit', failureCode: 'ENAMETOOLONG', stderrFile: reducedRun.stderrFile,
    stderrSha256: reducedRun.stderrSha256 })
  writeFileSync(join(outputDir, reducedRun.stderrFile), 'tampered stderr')
  assert.equal(validateBoundaryReport(result, observedGit).captureStatus, 'unavailable')

  git(fixture.repo, 'checkout', '-q', fixture.repaired)
  const safe = runBoundaryProbe({ config, worktreePath: fixture.repo, mergeBase: fixture.base,
    headSha: fixture.repaired, outputDir: join(fixture.dir, 'safe-probe'), optIn: true })
  assert.equal(safe.status, 'available'); assert.equal(safe.candidates.length, 0)
  const safeGit = collectGitEvidence({ worktreePath: fixture.repo, mergeBase: fixture.base, headSha: fixture.repaired })
  const safeValidated = validateBoundaryReport(safe, safeGit)
  assert.equal(safeValidated.captureStatus, 'available', safeValidated.reason)
  assert.equal(safeValidated.summary.reducedFailure, undefined)
  assert.match(safe.provenance.sources.defective.sha256, /^[a-f0-9]{64}$/)
  assert.equal(safe.provenance.sources.defective.sha256,
    createHash('sha256').update(execFileSync('git', ['-C', fixture.repo, 'show', `${fixture.repaired}:${SOURCE}`])).digest('hex'))

  git(fixture.repo, 'checkout', '-q', fixture.hashedHead)
  const hashed = runBoundaryProbe({ config: { ...config, repairedCommit: undefined }, worktreePath: fixture.repo,
    mergeBase: fixture.base, headSha: fixture.hashedHead, outputDir: join(fixture.dir, 'hashed-probe'), optIn: true })
  assert.equal(hashed.status, 'available'); assert.equal(hashed.candidates.length, 0)

  git(fixture.repo, 'checkout', '-q', fixture.unexpectedHead)
  const unexpected = runBoundaryProbe({ config: { ...config, repairedCommit: undefined }, worktreePath: fixture.repo,
    mergeBase: fixture.base, headSha: fixture.unexpectedHead, outputDir: join(fixture.dir, 'unexpected-probe'), optIn: true })
  assert.equal(unexpected.status, 'unavailable')
  assert.match(unexpected.reason, /unexpected exit/)

  git(fixture.repo, 'checkout', '-q', fixture.signalHead)
  const signalled = runBoundaryProbe({ config: { ...config, repairedCommit: undefined }, worktreePath: fixture.repo,
    mergeBase: fixture.base, headSha: fixture.signalHead, outputDir: join(fixture.dir, 'signal-probe'), optIn: true })
  assert.equal(signalled.status, 'unavailable')
  assert.ok(signalled.results.some(row => Object.values(row.runs).some(run => run.signal === 'SIGTERM')))
})

test('explicit Node filename adapter runs a changed module at another path with a fixed CLI contract', t => {
  const sourcePath = 'src/filename.mjs', fixture = cliHistory(t, sourcePath), outputDir = join(fixture.dir, 'probe')
  const config = { schema: 1, trustedRoot: fixture.repo, repoSlug: 'r', seed: 19, maxInputs: 8,
    sourcePath, operation: 'node-fs.mkdtempSync.filename',
    expectedProperty: 'valid ASCII targets produce a component within the observed byte limit', suffix: 'x' }
  const result = runBoundaryProbe({ config, worktreePath: fixture.repo, mergeBase: fixture.base,
    headSha: fixture.head, outputDir, optIn: true })
  assert.equal(result.status, 'available', result.reason)
  assert.equal(result.source, sourcePath)
  assert.equal(result.contract.operation, config.operation)
  assert.equal(result.contract.validInput, 'nonempty ASCII target slug [a-z0-9-]+; run-log start arguments fixed by adapter')
  assert.equal(result.contract.invocationBudget.shrinkSteps, 10)
  assert.ok(result.candidates.length > 0)
  const observedGit = collectGitEvidence({ worktreePath: fixture.repo, mergeBase: fixture.base, headSha: fixture.head })
  assert.equal(validateBoundaryReport(result, observedGit).captureStatus, 'available')
})

test('boundary-probe CLI validates worktree metadata and input budgets', t => {
  const fixture = cliHistory(t), configPath = join(fixture.dir, 'invalid-config.json')
  const metadataPath = join(fixture.dir, 'worktree.json'), outputDir = join(fixture.dir, 'cli-output')
  writeFileSync(configPath, JSON.stringify({ schema: 1, trustedRoot: fixture.repo, repoSlug: 'r', seed: 1, maxInputs: 101 }))
  writeFileSync(metadataPath, JSON.stringify({ worktreePath: fixture.repo, mergeBase: fixture.base, headSha: fixture.head }))
  const script = 'plugins/olko-github-pr/skills/lekker-review/scripts/boundary-probe.mjs'
  const child = spawnSync(process.execPath, [script, '--trusted-opt-in', '--config', configPath,
    '--worktree', metadataPath, '--out', outputDir], { encoding: 'utf8' })
  assert.equal(child.status, 1, child.stderr)
  assert.equal(JSON.parse(child.stdout).status, 'unavailable')
})

test('evidence bundle carries explicitly opted-in boundary provenance and unavailable state', t => {
  const fixture = cliHistory(t), configPath = join(fixture.dir, 'trusted.json'), outputDir = join(fixture.dir, 'bundle-probe')
  const lintPath = join(fixture.dir, 'lint.json'), receiptPath = join(fixture.dir, 'lint-receipt.json')
  const lintBytes = Buffer.from('[]')
  writeFileSync(configPath, JSON.stringify({ schema: 1, trustedRoot: fixture.repo, repoSlug: 'r', seed: 8,
    maxInputs: 8, repairedCommit: fixture.repaired }))
  writeFileSync(lintPath, lintBytes)
  writeFileSync(receiptPath, JSON.stringify({ schema: 1, status: 'available', baseSha: fixture.base,
    headShaBefore: fixture.head, headShaAfter: fixture.head, trackedCleanBefore: true, trackedCleanAfter: true,
    exitCode: 0, reportSha256: createHash('sha256').update(lintBytes).digest('hex') }))
  const metadata = { worktreePath: fixture.repo, mergeBase: fixture.base, headSha: fixture.head,
    eslintJson: lintPath, eslintProvenance: receiptPath }
  const bundle = collectEvidence(metadata, { trustedOptIn: true, configPath, outputDir })
  assert.equal(bundle.boundary.captureStatus, 'available', JSON.stringify(bundle.boundary))
  assert.equal(bundle.boundary.provenance.baseSha, fixture.base)
  assert.equal(bundle.boundary.summary.evidenceClass, 'composed trusted CLI probe')
  assert.equal(bundle.boundary.summary.reducedFailure.failureCode, 'ENAMETOOLONG')
  const compact = structuredClone(bundle)
  delete compact.git.diff.text; delete compact.lint.report; delete compact.boundary.report.results
  assert.equal(compact.boundary.summary.reducedFailure.exitClass, 'component-limit')
  assert.match(compact.boundary.summary.reducedFailure.stderrSha256, /^[a-f0-9]{64}$/)
  const unavailable = collectEvidence(metadata, { trustedOptIn: true, configPath: join(fixture.dir, 'missing'), outputDir: join(fixture.dir, 'other') })
  assert.equal(unavailable.boundary.captureStatus, 'unavailable')
  assert.match(unavailable.boundary.reason, /missing or malformed/)
})

test('adapter rejects opt-out, unchanged source path, stale identity, and reused artifacts', t => {
  const fixture = cliHistory(t), config = { schema: 1, trustedRoot: fixture.repo, repoSlug: 'r', seed: 3, maxInputs: 8 }
  const optOut = runBoundaryProbe({ config, worktreePath: fixture.repo, mergeBase: fixture.base,
    headSha: fixture.head, outputDir: join(fixture.dir, 'no-opt-in') })
  assert.equal(optOut.status, 'unavailable')
  assert.match(optOut.reason, /opt-in/)
  git(fixture.repo, 'checkout', '-q', fixture.unchangedPathHead)
  const stale = runBoundaryProbe({ config, worktreePath: fixture.repo, mergeBase: fixture.base,
    headSha: fixture.unchangedPathHead, outputDir: join(fixture.dir, 'stale'), optIn: true })
  assert.match(stale.reason, /changed paths/)
  git(fixture.repo, 'checkout', '-q', fixture.head)
  mkdirSync(join(fixture.dir, 'occupied'))
  const reused = runBoundaryProbe({ config, worktreePath: fixture.repo, mergeBase: fixture.base,
    headSha: fixture.head, outputDir: join(fixture.dir, 'occupied'), optIn: true })
  assert.match(reused.reason, /refusing to overwrite/)
})

test('bundle boundary validation preserves unavailable tampered and stale artifacts', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-boundary-report-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40), fileHash = 'c'.repeat(64)
  const run = { status: 'observed', exitClass: 'success', exitCode: 0, stdoutSha256: fileHash,
    stderrSha256: fileHash, stdoutFile: 'original/stdout.raw', stderrFile: 'original/stderr.raw' }
  const path = join(dir, 'report.json'), report = { schema: 1, status: 'available', source: SOURCE,
    provenance: { baseSha, headSha, trustedRoot: '/trusted', repoSlug: 'r', sources: {
      original: { commit: baseSha, sha256: fileHash }, defective: { commit: headSha, sha256: fileHash } },
      adapterSha256: fileHash, generatorSha256: fileHash, moduleSha256: {
        'boundary-cases.mjs': fileHash, 'boundary-filesystem.mjs': fileHash, 'boundary-invocation.mjs': fileHash,
        'boundary-probe-contract.mjs': fileHash, 'boundary-probe-runner.mjs': fileHash,
        'boundary-report.mjs': fileHash, 'boundary-source.mjs': fileHash, 'boundary-validation.mjs': fileHash, 'git-evidence.mjs': fileHash,
      }, runtime: 'v22' },
    seed: 7, contract: { count: 1, maxComponentBytes: 255, validInput: 'ASCII slug' }, candidates: [], results: [{ id: 'ascii-1', input: 'a', inputBytes: 1,
      inputSha256: createHash('sha256').update('a').digest('hex'), status: 'available',
      runs: { original: run, defective: { ...run, stdoutFile: 'defective/stdout.raw', stderrFile: 'defective/stderr.raw' } } }] }
  const bytes = Buffer.from(JSON.stringify(report)); writeFileSync(path, bytes)
  const gitEvidence = { status: 'available', provenance: { baseSha: report.provenance.baseSha, headSha: report.provenance.headSha }, changedPaths: [SOURCE] }
  const probe = { status: 'available', reportFile: path, reportSha256: createHash('sha256').update(bytes).digest('hex') }
  assert.equal(validateBoundaryReport(probe, gitEvidence).captureStatus, 'available', JSON.stringify(validateBoundaryReport(probe, gitEvidence)))
  const empty = { ...report, contract: { ...report.contract, count: 0 }, results: [] }, emptyBytes = Buffer.from(JSON.stringify(empty))
  writeFileSync(path, emptyBytes)
  assert.equal(validateBoundaryReport({ ...probe, reportSha256: createHash('sha256').update(emptyBytes).digest('hex') }, gitEvidence).captureStatus, 'unavailable')
  const incomplete = { ...report, results: [{ ...report.results[0], runs: { ...report.results[0].runs,
    defective: { ...report.results[0].runs.defective, status: 'unavailable' } } }] }
  const incompleteBytes = Buffer.from(JSON.stringify(incomplete)); writeFileSync(path, incompleteBytes)
  assert.equal(validateBoundaryReport({ ...probe, reportSha256: createHash('sha256').update(incompleteBytes).digest('hex') }, gitEvidence).captureStatus, 'unavailable')
  writeFileSync(path, bytes)
  assert.match(validateBoundaryReport({ ...probe, reportSha256: '0'.repeat(64) }, gitEvidence).reason, /hash/)
  assert.match(validateBoundaryReport(probe, { ...gitEvidence, provenance: { ...report.provenance, headSha: 'c'.repeat(40) } }).reason, /identity/)
  assert.equal(validateBoundaryReport({ ...probe, reportFile: join(dir, 'missing') }, gitEvidence).captureStatus, 'unavailable')
})
