import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const workflowPath = 'plugins/olko-github-pr/skills/lekker-review/workflow.js'
const source = readFileSync(workflowPath, 'utf8')
  .replace('export const meta =', 'const meta =')

const executeWorkflow = new AsyncFunction(
  'args',
  'agent',
  'parallel',
  'log',
  'phase',
  'budget',
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
}

async function runScenario({ depth = 'medium', worktreePath = null, respond }) {
  const calls = []
  const agent = async (prompt, options) => {
    calls.push(options.label)
    return respond({ prompt, options })
  }

  const result = await executeWorkflow(
    {
      repoSlug: 'example/repo',
      prNumber: 42,
      prUrl: 'https://github.com/example/repo/pull/42',
      depth,
      diffFile: '/tmp/pr.diff',
      contextFile: '/tmp/context.json',
      worktreePath,
      promptDir: '/tmp/prompts',
    },
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
  )

  return { calls, result }
}

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
  const important = { ...baseFinding, line: 11, severity: 'important' }
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
})

test('artifact contract renders passed-proof counter-evidence', () => {
  const artifactPrompt = readFileSync(
    'plugins/olko-github-pr/skills/lekker-review/references/artifact-page.md',
    'utf8',
  )

  assert.match(artifactPrompt, /proof\.outcome === 'passed'/)
  assert.match(artifactPrompt, /COUNTER-EVIDENCE/)
})
