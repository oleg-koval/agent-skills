import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const workflowPath = 'plugins/olko-github-pr/skills/lekker-review/workflow.js'
const source = readFileSync(workflowPath, 'utf8')
  .replace("import { readFileSync } from 'node:fs'", '')
  .replace('export const meta =', 'const meta =')

const executeWorkflow = new AsyncFunction(
  'args',
  'agent',
  'parallel',
  'log',
  'phase',
  'budget',
  'readFileSync',
  source,
)

const baseFinding = {
  file: 'src/example.ts',
  line: 10,
  severity: 'critical',
  title: 'Reachable failure',
  description: 'Normal execution fails.',
  badCode: 'return broken()',
  fix: 'return working()',
  boundary: { entryPoint: 'HTTP route', consumer: 'response handler' },
}

/**
 * Runs a test scenario for the lekker-review workflow with mocked agent responses.
 */
async function runScenario({ depth = 'medium', worktreePath = null, extraArgs = {}, respond }) {
  const calls = []
  const agent = async (prompt, options) => {
    calls.push(options.label)
    return respond({ prompt, options })
  }

  const result = await executeWorkflow(
    Object.assign({
      repoSlug: 'example/repo',
      prNumber: 42,
      prUrl: 'https://github.com/example/repo/pull/42',
      depth,
      diffFile: '/tmp/pr.diff',
      contextFile: '/tmp/context.json',
      worktreePath,
      promptDir: '/tmp/prompts',
      testRunner: { runner: 'vitest', dirs: [{ dir: '.', runner: 'vitest' }], reason: null },
    }, extraArgs),
    agent,
    async (thunks) => Promise.all(thunks.map(async (thunk) => {
      try {
        return await thunk()
      } catch {
        return null
      }
    })),
    () => {},
    () => {},
    { spent: () => 0 },
    readFileSync,
  )

  return { calls, result }
}

test('missing or incomplete boundaries cannot affect the verdict or receive proof', async () => {
  for (const depth of ['scan', 'medium']) {
    for (const severity of ['critical', 'important']) {
      for (const boundary of [undefined, null, [], 'HTTP route', {},
        { entryPoint: 'HTTP route' }, { consumer: 'session store' },
        { entryPoint: '  ', consumer: 'session store' },
        { entryPoint: 'HTTP route', consumer: 42 }]) {
        const { calls, result } = await runScenario({
          depth,
          worktreePath: '/tmp/fake-worktree',
          respond: ({ options }) => {
            if (options.label === (depth === 'scan' ? 'review:triage-quality' : 'review:quality')) {
              return { findings: [{ ...baseFinding, severity, boundary }] }
            }
            if (options.label.startsWith('review:')) return { findings: [] }
            throw new Error(`Unexpected agent call: ${options.label}`)
          },
        })
        assert.equal(result.findings[0].severity, 'observation')
        assert.equal(result.findings[0].verificationStatus, 'unverified')
        assert.equal(result.downgradedCount, 1)
        assert.ok(!calls.some((label) => /^(verify|prove):/.test(label)))
      }
    }
  }
})

test('critic findings without a downstream consumer remain unverified', async () => {
  const { calls, result } = await runScenario({
    depth: 'deep',
    worktreePath: '/tmp/fake-worktree',
    respond: ({ options }) => {
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label === 'critic') {
        return { angles: [{ axis: 'persistence', file: baseFinding.file, line: 10, reason: 'Recheck.' }] }
      }
      if (options.label.startsWith('critic-reexamine:')) {
        return { findings: [{ ...baseFinding, boundary: { entryPoint: 'HTTP route' } }] }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })
  assert.equal(result.findings[0].verificationStatus, 'unverified')
  assert.equal(result.findings[0].severity, 'observation')
  assert.ok(!calls.some((label) => /^(critic-verify|prove):/.test(label)))
})

test('imported confirmation or proof cannot bypass the boundary requirement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lekker-boundary-'))
  try {
    const findingsFile = join(dir, 'findings.json')
    writeFileSync(findingsFile, JSON.stringify({ findings: [{
      ...baseFinding, boundary: undefined, verificationStatus: 'proven',
      proof: { attempted: true, proven: true, outcome: 'proven' },
    }] }))
    const { calls, result } = await runScenario({
      worktreePath: '/tmp/fake-worktree',
      extraArgs: { engine: 'revmux', findingsFile },
      respond: ({ options }) => { throw new Error(`Unexpected agent call: ${options.label}`) },
    })
    assert.deepEqual(calls, [])
    assert.equal(result.findings[0].verificationStatus, 'unverified')
    assert.equal(result.findings[0].severity, 'observation')
    assert.equal(result.findings[0].proof, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('verifier failure cannot leave verdict-affecting findings', async () => {
  const critical = { ...baseFinding }
  const important = {
    ...baseFinding,
    line: 11,
    severity: 'important',
    title: 'Conditional data loss',
  }
  const { calls, result } = await runScenario({
    depth: 'scan',
    respond: ({ options }) => {
      if (options.label === 'review:triage-quality') {
        return { findings: [critical, important] }
      }
      if (options.label === 'review:triage-logic') return { findings: [] }
      if (options.label.startsWith('verify:')) return null
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(calls.filter((label) => label.startsWith('verify:')).length, 2)
  assert.deepEqual(result.findings.map((finding) => finding.severity), [
    'observation',
    'observation',
  ])
  assert.ok(result.findings.every((finding) => finding.verificationStatus === 'unavailable'))
})

test('every verdict-affecting finding is verified regardless of depth', async () => {
  // A genuinely different defect, not the same one reported at the next line.
  // Dedup collapses one defect repeated across nearby lines, and this test is
  // about depth rather than dedup: it must show that an Important finding is
  // verified at scan depth, which needs two findings that survive dedup.
  const important = {
    ...baseFinding,
    line: 42,
    severity: 'important',
    title: 'Unchecked null dereference',
  }
  const { calls, result } = await runScenario({
    depth: 'scan',
    respond: ({ options }) => {
      if (options.label === 'review:triage-quality') {
        return { findings: [{ ...baseFinding }, important] }
      }
      if (options.label === 'review:triage-logic') return { findings: [] }
      if (options.label.startsWith('verify:')) {
        return { verdict: 'confirmed', reasoning: 'The finding is anchored and reachable.' }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(calls.filter((label) => label.startsWith('verify:')).length, 2)
  assert.ok(result.findings.every((finding) => finding.verificationStatus === 'confirmed'))
})

test('deep critic findings carry verification status', async () => {
  const criticFinding = { ...baseFinding, severity: 'important' }
  const { result } = await runScenario({
    depth: 'deep',
    respond: ({ options }) => {
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label === 'critic') {
        return { angles: [{ axis: 'rollback', file: criticFinding.file, line: 10, reason: 'Recheck.' }] }
      }
      if (options.label.startsWith('critic-reexamine:')) {
        return { findings: [criticFinding] }
      }
      if (options.label.startsWith('critic-verify:')) {
        return { verdict: 'confirmed', reasoning: 'The critic finding is confirmed.' }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(result.findings[0].verificationStatus, 'confirmed')
})

test('critic dedup keeps verification evidence from a higher-severity finding', async () => {
  const observation = { ...baseFinding, severity: 'observation' }
  const criticFinding = { ...baseFinding, severity: 'critical' }
  const { result } = await runScenario({
    depth: 'deep',
    respond: ({ options }) => {
      if (options.label === 'review:quality') return { findings: [observation] }
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label === 'critic') {
        return { angles: [{ axis: 'rollback', file: criticFinding.file, line: 10, reason: 'Recheck.' }] }
      }
      if (options.label.startsWith('critic-reexamine:')) {
        return { findings: [criticFinding] }
      }
      if (options.label.startsWith('critic-verify:')) {
        return { verdict: 'confirmed', reasoning: 'The critic finding is confirmed.' }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(result.findings[0].severity, 'critical')
  assert.equal(result.findings[0].verificationStatus, 'confirmed')
  assert.equal(result.findings[0].verifierReasoning, 'The critic finding is confirmed.')
})

test('hard rules go through anchor and applicability validation', async () => {
  const hardRuleFinding = { ...baseFinding, rule: 'TS-1' }
  const { calls, result } = await runScenario({
    respond: ({ options }) => {
      if (options.label === 'review:quality') return { findings: [hardRuleFinding] }
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label.startsWith('verify:')) {
        return { verdict: 'dropped', reasoning: 'The added line does not violate TS-1.' }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(calls.filter((label) => label.startsWith('verify:')).length, 1)
  assert.equal(result.hardRuleCount, 1)
  assert.deepEqual(result.findings, [])
})

test('hard-rule verification is counted when the verifier returns no result', async () => {
  const hardRuleFinding = { ...baseFinding, rule: 'TS-1' }
  const { result } = await runScenario({
    respond: ({ options }) => {
      if (options.label === 'review:quality') return { findings: [hardRuleFinding] }
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label.startsWith('verify:')) return null
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(result.hardRuleCount, 1)
  assert.equal(result.findings[0].severity, 'observation')
  assert.equal(result.findings[0].verificationStatus, 'unavailable')
  assert.equal(
    result.findings[0].verifierReasoning,
    'verifier agent returned no usable result; downgraded to non-blocking',
  )
})

test('prove is skipped without an installed test runner', async () => {
  const { calls, result } = await runScenario({
    worktreePath: '/tmp/fake-worktree',
    extraArgs: { testRunner: { runner: null, dirs: [], reason: '.: vitest declared but node_modules/.bin/vitest missing' } },
    respond: ({ options }) => {
      if (options.label === 'review:quality') return { findings: [{ ...baseFinding }] }
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label.startsWith('verify:')) {
        return { verdict: 'confirmed', reasoning: 'Failure is reachable and unmitigated.' }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(calls.some((label) => label.startsWith('prove:')), false)
  assert.equal(result.findings[0].severity, 'critical')
  assert.equal(result.findings[0].proof.outcome, 'not_attempted')
  assert.match(result.findings[0].proof.reason, /no runnable test runner/)
})

test('provers receive every package paired with its detected runner', async () => {
  let proofPrompt
  const dirs = [
    { dir: '.', runner: 'vitest' },
    { dir: 'packages/api', runner: 'jest' },
    { dir: 'packages/cli', runner: 'node-test' },
  ]
  const { calls } = await runScenario({
    worktreePath: '/tmp/fake-worktree',
    extraArgs: { testRunner: { runner: 'vitest', dirs, reason: null } },
    respond: ({ prompt, options }) => {
      if (options.label === 'review:quality') return { findings: [{ ...baseFinding, file: 'packages/api/src/example.ts' }] }
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label.startsWith('verify:')) return { verdict: 'confirmed', reasoning: 'Reachable failure.' }
      if (options.label.startsWith('prove:')) {
        proofPrompt = prompt
        return { attempted: false, proven: false, outcome: 'not_attempted', reason: 'Fixture only.' }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })
  assert.ok(calls.some((label) => label.startsWith('prove:packages/api/')))
  assert.ok(proofPrompt.includes(JSON.stringify(dirs)), 'prover must receive the directory-to-runner mapping')
})

test('a passing proof automatically downgrades a Critical finding', async () => {
  const { result } = await runScenario({
    worktreePath: '/tmp/fake-worktree',
    respond: ({ options }) => {
      if (options.label === 'review:quality') return { findings: [{ ...baseFinding }] }
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label.startsWith('verify:')) {
        return { verdict: 'confirmed', reasoning: 'Failure is reachable and unmitigated.' }
      }
      if (options.label.startsWith('prove:')) {
        return {
          attempted: true,
          proven: false,
          outcome: 'passed',
          reason: 'The focused test passed; the code behaved correctly.',
          testCode: 'test("works", () => {})',
          testCommand: 'npm test -- works',
        }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(result.findings[0].severity, 'important')
  assert.equal(result.findings[0].verificationStatus, 'counter-evidence')
})

/**
 * An Important finding with a composed boundary map should route through
 * Prove the same way a Critical finding does, and a successful proof should
 * mark the finding as proven rather than merely verified.
 */
test('an Important finding with a composed boundary receives proof', async () => {
  const boundaryFinding = {
    ...baseFinding,
    severity: 'important',
    boundary: {
      entryPoint: 'gateway ingress',
      consumer: 'durable session store',
      realizationPoint: 'turn runtime',
      transitions: ['success', 'fallback'],
    },
  }
  const { calls, result } = await runScenario({
    worktreePath: '/tmp/fake-worktree',
    respond: ({ options }) => {
      if (options.label === 'review:quality') return { findings: [boundaryFinding] }
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label.startsWith('verify:')) {
        return { verdict: 'confirmed', reasoning: 'The boundary contract is reachable.' }
      }
      if (options.label.startsWith('prove:')) {
        return {
          attempted: true,
          proven: true,
          outcome: 'proven',
          reason: 'The composed probe reproduces the mismatch.',
          testCode: 'test("reproduces", () => {})',
          testCommand: 'npm test -- reproduces',
          redOutput: 'Expected durable identity, received physical identity.',
        }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(calls.filter((label) => label.startsWith('prove:')).length, 1)
  assert.equal(result.findings[0].verificationStatus, 'proven')
  assert.equal(result.provenCount, 1)
})

test('contradictory proof tuples cannot change a finding verdict', async () => {
  for (const proof of [
    {
      attempted: false,
      proven: false,
      outcome: 'passed',
      reason: 'No test ran.',
    },
    {
      attempted: false,
      proven: true,
      outcome: 'not_attempted',
      reason: 'No test ran.',
    },
    {
      attempted: true,
      proven: false,
      outcome: 'passed',
      reason: 'Claimed green without executable evidence.',
    },
    {
      attempted: true,
      proven: true,
      outcome: 'proven',
      reason: 'Claimed red without failure output.',
      testCode: 'test("fails", () => {})',
      testCommand: 'npm test -- fails',
    },
  ]) {
    const { result } = await runScenario({
      worktreePath: '/tmp/fake-worktree',
      respond: ({ options }) => {
        if (options.label === 'review:quality') return { findings: [{ ...baseFinding }] }
        if (options.label.startsWith('review:')) return { findings: [] }
        if (options.label.startsWith('verify:')) {
          return { verdict: 'confirmed', reasoning: 'Failure is reachable and unmitigated.' }
        }
        if (options.label.startsWith('prove:')) return proof
        throw new Error(`Unexpected agent call: ${options.label}`)
      },
    })

    assert.equal(result.findings[0].severity, 'critical')
    assert.equal(result.findings[0].verificationStatus, 'confirmed')
    assert.equal(result.provenCount, 0)
    assert.match(result.findings[0].proof.reason, /inconsistent proof state/i)
  }
})

test('hard-rule verifier receives the canonical rules-file instruction', async () => {
  let verifierPrompt = ''
  const { result } = await runScenario({
    respond: ({ prompt, options }) => {
      if (options.label === 'review:quality') {
        return { findings: [{ ...baseFinding, rule: 'TS-1' }] }
      }
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label.startsWith('verify:')) {
        verifierPrompt = prompt
        return { verdict: 'confirmed', reasoning: 'TS-1 applies.' }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(result.findings[0].verificationStatus, 'hard-rule-confirmed')
  assert.match(verifierPrompt, /HOUSE_RULES_FILE/)
  assert.match(verifierPrompt, /houseRulesFile/)
})

test('custom non-empty rule tags use hard-rule verification', async () => {
  const { result } = await runScenario({
    respond: ({ options }) => {
      if (options.label === 'review:quality') {
        return { findings: [{ ...baseFinding, rule: 'SEC-1' }] }
      }
      if (options.label.startsWith('review:')) return { findings: [] }
      if (options.label.startsWith('verify:')) {
        return { verdict: 'confirmed', reasoning: 'SEC-1 is anchored and applicable.' }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(result.hardRuleCount, 1)
  assert.equal(result.findings[0].verificationStatus, 'hard-rule-confirmed')
})

test('acceptance and test-quality metadata survive aggregation', async () => {
  const { result } = await runScenario({
    respond: ({ options }) => {
      if (options.label === 'review:implementation') {
        return { findings: [], acCoverage: 'AC 1 met; AC 2 missing.' }
      }
      if (options.label === 'review:test-quality') {
        return {
          findings: [],
          coverageVerdict: 'Partially tested',
          mutationSlip: 'An operator flip would escape.',
          mockSmells: [{
            file: 'src/example.test.ts',
            line: 20,
            description: 'Asserts call shape.',
            fix: 'Assert returned state.',
          }],
        }
      }
      if (options.label.startsWith('review:')) return { findings: [] }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.equal(result.acCoverage, 'AC 1 met; AC 2 missing.')
  assert.equal(result.coverageVerdict, 'Partially tested')
  assert.equal(result.mutationSlip, 'An operator flip would escape.')
  assert.equal(result.mockSmells.length, 1)
})

test('revmux adapter metadata and engine identity survive workflow aggregation', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'lekker-revmux-workflow-'))
  try {
    const skillDir = 'plugins/olko-github-pr/skills/lekker-review'
    const adapterOutput = execFileSync('node', [
      join(skillDir, 'scripts/revmux-adapter.mjs'),
      join(skillDir, 'scripts/fixtures/revmux-report.json'),
      '--context', join(skillDir, 'scripts/fixtures/context.json'),
    ], { encoding: 'utf8' })
    const findingsFile = join(tempDir, 'findings.json')
    writeFileSync(findingsFile, adapterOutput)

    const { calls, result } = await runScenario({
      extraArgs: { engine: 'revmux', findingsFile },
      respond: ({ options }) => {
        throw new Error(`Unexpected agent call: ${options.label}`)
      },
    })

    assert.deepEqual(calls, [])
    assert.equal(result.engine, 'revmux')
    assert.match(result.acCoverage, /Race between webhook retry and manual sync writes duplicate fulfillment/)
    assert.match(result.coverageVerdict, /Operator-flip mutation/)
    assert.match(result.mutationSlip, /retry guard/)
    assert.equal(result.mockSmells.length, 1)
    assert.ok(result.pricingMissing.includes('claude-sonnet-5'))
    const adapted = JSON.parse(adapterOutput).findings
    assert.ok(adapted.length > 0)
    assert.ok(result.findings.every((finding) => typeof finding.dimension === 'string'))
    assert.ok(result.findings.every((finding) => ['quality', 'implementation', 'simplification', 'conventions', 'test-quality', 'critic', 'unknown'].includes(finding.dimension)))
    for (const f of adapted.concat(result.findings)) {
      assert.match(f.bugClass, /^[a-z0-9]+(-[a-z0-9]+)*$/)
      assert.deepEqual(f.otherInstances, [])
    }

    writeFileSync(findingsFile, JSON.stringify({ findings: [
      { ...baseFinding, title: 'Bad Thing Here', bugClass: 'Not A Slug', otherInstances: ['src/b.ts:3', '/etc/passwd:1', 7] },
    ] }))
    const second = await runScenario({
      extraArgs: { engine: 'revmux', findingsFile },
      respond: ({ options }) => { throw new Error(`Unexpected agent call: ${options.label}`) },
    })
    assert.equal(second.result.findings[0].bugClass, 'bad-thing-here')
    assert.deepEqual(second.result.findings[0].otherInstances, ['src/b.ts:3'])

    writeFileSync(findingsFile, JSON.stringify({ findings: [
      { ...baseFinding, dimension: ['lekker-quality', 'lekker-implementation'] },
    ] }))
    const third = await runScenario({
      extraArgs: { engine: 'revmux', findingsFile },
      respond: ({ options }) => { throw new Error(`Unexpected agent call: ${options.label}`) },
    })
    assert.equal(third.result.findings[0].dimension, 'quality')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('reviewer prompts explicitly require structured metadata fields', () => {
  const implementationPrompt = readFileSync(
    'plugins/olko-github-pr/skills/lekker-review/references/agents/implementation.md',
    'utf8',
  )
  const testQualityPrompt = readFileSync(
    'plugins/olko-github-pr/skills/lekker-review/references/agents/test-quality.md',
    'utf8',
  )

  assert.match(implementationPrompt, /acCoverage/)
  assert.match(testQualityPrompt, /coverageVerdict/)
  assert.match(testQualityPrompt, /mutationSlip/)
  assert.match(testQualityPrompt, /mockSmells/)
})

/**
 * Each review dimension's schema should require the structured fields its
 * downstream consumers depend on, including the quality dimension's boundary
 * object used by the Prove stage.
 */
test('dimension schemas enforce structured metadata contracts', async () => {
  const schemas = new Map()
  await runScenario({
    respond: ({ options }) => {
      if (options.label.startsWith('review:')) {
        schemas.set(options.label, options.schema)
        if (options.label === 'review:implementation') {
          return { findings: [], acCoverage: 'All acceptance criteria met.' }
        }
        if (options.label === 'review:test-quality') {
          return {
            findings: [],
            coverageVerdict: 'Covered',
            mutationSlip: 'No obvious gap.',
            mockSmells: [],
          }
        }
        return { findings: [] }
      }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })

  assert.ok(schemas.get('review:implementation').required.includes('acCoverage'))
  const testQualitySchema = schemas.get('review:test-quality')
  assert.ok(testQualitySchema.required.includes('coverageVerdict'))
  assert.ok(testQualitySchema.required.includes('mutationSlip'))
  assert.ok(testQualitySchema.required.includes('mockSmells'))
  assert.deepEqual(
    testQualitySchema.properties.mockSmells.items.required,
    ['file', 'line', 'description', 'fix'],
  )
  assert.equal(
    schemas.get('review:quality').properties.findings.items.properties.rule.type,
    'string',
  )
  const findingSchema = schemas.get('review:quality').properties.findings.items
  const boundary = findingSchema.properties.boundary
  assert.equal(boundary.type, 'object')
  for (const key of ['entryPoint', 'consumer', 'realizationPoint', 'stateOwner', 'transitions']) {
    assert.ok(Object.hasOwn(boundary.properties, key), `boundary is missing ${key}`)
  }
  assert.deepEqual(boundary.required, ['entryPoint', 'consumer'])
  for (const key of boundary.required) {
    assert.equal(boundary.properties[key].minLength, 1)
    assert.equal(boundary.properties[key].pattern, '\\S')
  }
  assert.deepEqual(findingSchema.anyOf, [
    { properties: { severity: { enum: ['observation', 'idiomatic'] } } },
    { required: ['boundary'] },
  ])
})

test('artifact contract renders passed-proof counter-evidence', () => {
  const artifactPrompt = readFileSync(
    'plugins/olko-github-pr/skills/lekker-review/references/artifact-page.md',
    'utf8',
  )

  assert.match(artifactPrompt, /proof\.outcome === 'passed'/)
  assert.match(artifactPrompt, /COUNTER-EVIDENCE/)
  assert.match(artifactPrompt, /with `reason`,/)
  assert.match(artifactPrompt, /`testCommand`/)
  assert.match(artifactPrompt, /downgraded the finding to Important/)
  assert.match(artifactPrompt, /do not present the\s+passing input as proof that every related input is safe/)
})

test('findings expose their originating agent as dimension, not _dimension', async () => {
  const { result } = await runScenario({
    respond: ({ options }) => (options.label === 'review:conventions'
      ? { findings: [{ ...baseFinding, severity: 'observation' }] }
      : { findings: [] }),
  })
  assert.equal(result.findings[0].dimension, 'conventions')
  assert.equal(result.findings[0]._dimension, undefined)
})

test('review schema requires bugClass and otherInstances, and merging unions instances', async () => {
  const { calls, result } = await runScenario({
    respond: ({ prompt, options }) => {
      if (options.label === 'review:quality') {
        assert.match(prompt, /BUG CLASS/)
        return { findings: [
          { ...baseFinding, severity: 'observation', bugClass: 'x-class', otherInstances: ['a.ts:1'] },
          { ...baseFinding, severity: 'observation', line: 12, bugClass: 'x-class', otherInstances: ['b.ts:2'] },
        ] }
      }
      return { findings: [] }
    },
  })
  assert.ok(calls.includes('review:quality'))
  const src = readFileSync(workflowPath, 'utf8')
  assert.match(src, /required: \[[^\]]*'bugClass', 'otherInstances'\]/)
  const merged = result.findings.filter((f) => f.bugClass === 'x-class')
  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].otherInstances, ['a.ts:1', 'b.ts:2'])
})

test('findings of different bug classes are never merged', async () => {
  const { result } = await runScenario({
    respond: ({ options }) => (options.label === 'review:quality'
      ? { findings: [
        { ...baseFinding, severity: 'observation', bugClass: 'x-class', otherInstances: ['a.ts:1'] },
        { ...baseFinding, severity: 'observation', line: 12, bugClass: 'y-class', otherInstances: ['b.ts:2'] },
      ] }
      : { findings: [] }),
  })
  const byClass = Object.fromEntries(result.findings.map((f) => [f.bugClass, f.otherInstances]))
  assert.deepEqual(byClass, { 'x-class': ['a.ts:1'], 'y-class': ['b.ts:2'] })
})

test('critic re-examination asks for the bug class and its other instances', () => {
  const src = readFileSync(workflowPath, 'utf8')
  assert.match(src, /Return zero or one finding using DIFF_FILE=\$\{diffFile\} and WORKTREE_PATH=\$\{wtDisplay\}\.`,\s+BUG_CLASS_INSTRUCTION,/)
})

test('cycle 4 returns a rethink verdict with recurring classes and runs no agents', async () => {
  const recurring = [{ class: 'missing-null-check', cycles: 3 }]
  const { calls, result } = await runScenario({
    extraArgs: { cycle: 4, recurringClasses: recurring },
    respond: ({ options }) => { throw new Error(`Unexpected agent call: ${options.label}`) },
  })
  assert.deepEqual(calls, [])
  assert.equal(result.verdict, 'rethink')
  assert.deepEqual(result.recurringClasses, recurring)
  assert.deepEqual(result.findings, [])
})

test('cycle 3 still reviews', async () => {
  const { calls } = await runScenario({
    extraArgs: { cycle: 3 },
    respond: ({ options }) => ({ findings: [] }),
  })
  assert.ok(calls.some((label) => label.startsWith('review:')))
})

test('rejected findings are never re-raised, even at a moved line', async () => {
  const suppressed = [{ file: baseFinding.file, line: 12, title: 'Reachable failure', status: 'rejected' }]
  const other = { ...baseFinding, file: 'src/other.ts', title: 'Unrelated race' }
  const { calls, result } = await runScenario({
    extraArgs: { cycle: 2, suppressed },
    respond: ({ prompt, options }) => {
      if (options.label === 'review:quality') {
        assert.match(prompt, /ALREADY ANSWERED/)
        return { findings: [{ ...baseFinding, severity: 'observation' }, { ...other, severity: 'observation' }] }
      }
      if (options.label.startsWith('review:')) return { findings: [] }
      throw new Error(`Unexpected agent call: ${options.label}`)
    },
  })
  assert.ok(calls.includes('review:quality'))
  assert.deepEqual(result.findings.map((f) => f.file), ['src/other.ts'])
  assert.equal(result.suppressedCount, 1)
})
