export const meta = {
  name: 'lekker-review-core',
  description: 'Parallel specialist PR review with per-finding adversarial verification',
  phases: [ { title: 'Review' }, { title: 'Verify' }, { title: 'Critic' }, { title: 'Prove' } ],
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'severity', 'title', 'description', 'badCode', 'fix'],
        properties: {
          file:        { type: 'string' },
          line:        { type: 'integer' },
          severity:    { enum: ['critical', 'important', 'observation', 'idiomatic'] },
          title:       { type: 'string' },
          description: { type: 'string' },
          badCode:     { type: 'string' },
          fix:         { type: 'string' },
          precedent:   { type: 'string' },
          rule:        { enum: ['TS-1', 'TS-2', 'GQL-1', 'PR-1'] },
        },
      },
    },
    acCoverage:      { type: 'string' },
    mutationSlip:    { type: 'string' },
    coverageVerdict: { type: 'string' },
    mockSmells: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file:        { type: 'string' },
          line:        { type: 'integer' },
          description: { type: 'string' },
          fix:         { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'reasoning'],
  properties: {
    verdict:     { enum: ['confirmed', 'downgraded', 'dropped'] },
    newSeverity: { enum: ['important', 'observation'] },
    reasoning:   { type: 'string' },
  },
}

const CRITIC_SCHEMA = {
  type: 'object',
  required: ['angles'],
  properties: {
    angles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['axis', 'file', 'line', 'reason'],
        properties: {
          axis:   { type: 'string' },
          file:   { type: 'string' },
          line:   { type: 'integer' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

const PROOF_SCHEMA = {
  type: 'object',
  required: ['attempted', 'proven', 'reason'],
  properties: {
    attempted:   { type: 'boolean' },
    proven:      { type: 'boolean' },
    reason:      { type: 'string' },
    testCode:    { type: 'string' },
    testCommand: { type: 'string' },
    redOutput:   { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HARD_RULES = ['TS-1', 'TS-2', 'GQL-1', 'PR-1']

function isHardRule(finding) {
  return typeof finding.rule === 'string' && HARD_RULES.indexOf(finding.rule) !== -1
}

const SEVERITY_RANK = { critical: 3, important: 2, observation: 1, idiomatic: 0 }

function titleTokens(title) {
  const words = String(title || '').toLowerCase().match(/[a-z0-9]+/g) || []
  return words.filter(function(w) { return w.length > 2 })
}

function sameIssue(a, b) {
  const ta = titleTokens(a.title)
  const tb = titleTokens(b.title)
  if (ta.length === 0 || tb.length === 0) {
    return false
  }
  const setB = new Set(tb)
  const shared = ta.filter(function(w) { return setB.has(w) }).length
  const union = new Set(ta.concat(tb)).size
  return (shared / union) >= 0.4
}

function longest(a, b) {
  const sa = a || ''
  const sb = b || ''
  return sb.length > sa.length ? sb : sa
}

// Merge two findings that were independently flagged as the same issue at the
// same file:line. A critical found by one dimension must not be silently
// demoted to an observation found by another dimension at the same line, so
// merging always keeps the highest severity and the most detailed text
// across the merged set, and unions the set of dimensions that agreed.
function mergeFindings(a, b) {
  const merged = Object.assign({}, a)

  if (SEVERITY_RANK[b.severity] > SEVERITY_RANK[merged.severity]) {
    merged.severity = b.severity
  }

  merged.description = longest(a.description, b.description)
  merged.badCode = longest(a.badCode, b.badCode)
  merged.fix = longest(a.fix, b.fix)
  merged.precedent = longest(a.precedent, b.precedent)

  if (!merged.rule && b.rule) {
    merged.rule = b.rule
  }

  const agreedBy = []
  const contributors = (a.agreedBy || (a._dimension ? [a._dimension] : []))
    .concat(b.agreedBy || (b._dimension ? [b._dimension] : []))
  for (const dim of contributors) {
    if (dim && agreedBy.indexOf(dim) === -1) {
      agreedBy.push(dim)
    }
  }
  if (agreedBy.length > 0) {
    merged.agreedBy = agreedBy
  }

  return merged
}

function dedup(allFindings) {
  const byLocation = new Map()
  for (const f of allFindings) {
    const key = `${f.file}:${f.line}`
    if (!byLocation.has(key)) {
      byLocation.set(key, [])
    }
    byLocation.get(key).push(f)
  }

  const result = []
  for (const candidates of byLocation.values()) {
    const groups = []
    for (const candidate of candidates) {
      const match = groups.find(function(g) { return sameIssue(g[0], candidate) })
      if (match) {
        match.push(candidate)
      } else {
        groups.push([candidate])
      }
    }
    for (const group of groups) {
      result.push(group.reduce(mergeFindings))
    }
  }
  return result
}

function shouldVerify(finding, depth) {
  // house hard rules are policy violations, not runtime-failure claims. The
  // five adversarial challenges cannot be answered for them, so verifying
  // would systematically drop findings that are Critical by policy.
  if (isHardRule(finding)) {
    return false
  }
  if (depth === 'scan') {
    return false
  }
  if (depth === 'medium') {
    return finding.severity === 'critical'
  }
  // deep: critical + important
  return finding.severity === 'critical' || finding.severity === 'important'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// The workflow harness executes this script body directly in an async context;
// `args` is a global provided by the runtime. It may arrive as a JSON string
// depending on how the caller encoded it, so normalize before destructuring.
const input = (typeof args === 'string') ? JSON.parse(args) : (args || {})
const {
  repoSlug,
  prNumber,
  prUrl,
  depth,
  diffFile,
  contextFile,
  worktreePath,
  promptDir,
  prevSha,
} = input

if (!repoSlug || !prNumber || !depth || !diffFile || !contextFile || !promptDir) {
  throw new Error(
    'lekker-review workflow: missing required args (got type ' + typeof args +
    '): ' + JSON.stringify({ repoSlug, prNumber, depth, diffFile, contextFile, promptDir })
  )
}
log(`args ok: PR #${prNumber} in ${repoSlug}, depth=${depth}`)

const budgetAtStart = budget.spent()

  let agentCount = 0
  let droppedCount = 0
  let downgradedCount = 0
  let hardRuleCount = 0
  let provenCount = 0
  let proveAttemptCount = 0

  // -------------------------------------------------------------------------
  // Dimensions by depth
  // -------------------------------------------------------------------------

  const isScan = depth === 'scan'

  const dimensions = isScan
    ? [
        { key: 'triage-quality', file: 'triage-quality.md', model: 'haiku' },
        { key: 'triage-logic',   file: 'triage-logic.md',   model: 'haiku' },
      ]
    : [
        { key: 'quality',        file: 'quality.md',        model: 'sonnet' },
        { key: 'implementation', file: 'implementation.md', model: 'sonnet' },
        { key: 'simplification', file: 'simplification.md', model: 'sonnet' },
        { key: 'conventions',    file: 'conventions.md',    model: 'sonnet' },
        { key: 'test-quality',   file: 'test-quality.md',   model: 'sonnet' },
      ]

  const wtDisplay = worktreePath || 'null (scan mode: diff only)'

  // -------------------------------------------------------------------------
  // Build review agent envelope prompt
  // -------------------------------------------------------------------------

  function reviewPrompt(dim) {
    let prompt = [
      `You are the ${dim.key} review agent for PR #${prNumber} in ${repoSlug} (${prUrl}).`,
      `First Read and follow the prompt file: ${promptDir}/${dim.file}.`,
      `Parameters: REPO_SLUG=${repoSlug}, PR_NUMBER=${prNumber}, PR_URL=${prUrl},`,
      `DIFF_FILE=${diffFile}, CONTEXT_FILE=${contextFile}, WORKTREE_PATH=${wtDisplay}.`,
    ].join(' ')

    if (prevSha) {
      prompt += ` RE-REVIEW MODE: a prior review covered up to commit ${prevSha}.`
        + ` Focus findings on the delta (see key deltaFile in CONTEXT_FILE);`
        + ` use the full diff for context only.`
    }

    return prompt
  }

  // -------------------------------------------------------------------------
  // Build verifier agent prompt
  // -------------------------------------------------------------------------

  function verifierPrompt(finding) {
    return [
      `You are an adversarial finding verifier for PR #${prNumber} in ${repoSlug}.`,
      `Read and follow ${promptDir}/verifier.md.`,
      `FINDING (JSON): ${JSON.stringify(finding)}.`,
      `DIFF_FILE=${diffFile}, CONTEXT_FILE=${contextFile}, WORKTREE_PATH=${wtDisplay}.`,
      `Default to dropping when uncertain.`,
    ].join(' ')
  }

  // -------------------------------------------------------------------------
  // Review stage: run all dimensions in parallel via pipeline
  // -------------------------------------------------------------------------

  async function reviewStage(dim) {
    agentCount++
    const result = await agent(reviewPrompt(dim), {
      label:  `review:${dim.key}`,
      phase:  'Review',
      schema: FINDINGS_SCHEMA,
      model:  dim.model,
    })

    if (!result) {
      log(`${dim.key}: agent returned null, skipping`)
      return []
    }

    const findings = (result.findings || []).map(function(f) {
      const copy = Object.assign({}, f)
      copy._dimension = dim.key
      return copy
    })

    log(`${dim.key}: ${findings.length} findings, ${
      findings.filter(function(f) { return shouldVerify(f, depth) }).length
    } to verify`)

    return findings
  }

  // -------------------------------------------------------------------------
  // Verify stage: takes the deduped cross-dimension finding set, splits into
  // in-scope (adversarially verified) and out-of-scope (kept as-is, including
  // house hard rules which are exempt by policy), and runs verifiers in
  // parallel over the in-scope set.
  // -------------------------------------------------------------------------

  async function verifyAll(findings) {
    const inScope = findings.filter(function(f) {
      return shouldVerify(f, depth)
    })
    const outOfScope = findings.filter(function(f) {
      return !shouldVerify(f, depth)
    })

    const exempted = outOfScope.map(function(f) {
      if (!isHardRule(f)) {
        return f
      }
      hardRuleCount++
      const exempt = Object.assign({}, f)
      exempt.verifierReasoning = `hard rule ${f.rule}: exempt from adversarial verification (standards violation, not a runtime-failure claim)`
      return exempt
    })

    if (inScope.length === 0) {
      return exempted
    }

    const verified = await parallel(inScope.map(function(finding) {
      return async function() {
        agentCount++
        const verdict = await agent(verifierPrompt(finding), {
          label:  `verify:${finding.file}:${finding.line}`,
          model:  'sonnet',
          phase:  'Verify',
          schema: VERDICT_SCHEMA,
          effort: 'high',
        })

        if (!verdict) {
          // Null agent result: treat as confirmed-unverified
          const kept = Object.assign({}, finding)
          kept.verifierReasoning = 'verifier agent returned null; kept unverified'
          return kept
        }

        if (verdict.verdict === 'dropped') {
          droppedCount++
          return null
        }

        if (verdict.verdict === 'downgraded') {
          downgradedCount++
          const downgraded = Object.assign({}, finding)
          downgraded.severity = verdict.newSeverity || 'observation'
          downgraded.verifierReasoning = verdict.reasoning
          return downgraded
        }

        // confirmed
        const confirmed = Object.assign({}, finding)
        confirmed.verifierReasoning = verdict.reasoning
        return confirmed
      }
    }))

    return exempted.concat(verified.filter(Boolean))
  }

  // -------------------------------------------------------------------------
  // Review -> dedup -> verify: all reviewers run to completion (barrier),
  // then findings are deduped once across dimensions, then the unique set is
  // verified. This avoids burning two verifier agents (and risking two
  // contradictory verdicts) on the same issue found by two dimensions.
  // -------------------------------------------------------------------------

  phase('Review')

  const reviewed = await parallel(dimensions.map(function(dim) {
    return function() { return reviewStage(dim) }
  }))

  const deduped = dedup(reviewed.filter(Boolean).flat())

  log(`${deduped.length} unique finding(s) after dedup; verifying ${
    deduped.filter(function(f) { return shouldVerify(f, depth) }).length
  }`)

  phase('Verify')

  const verifiedFindings = await verifyAll(deduped)

  log(`Verify complete: ${verifiedFindings.length} finding(s) (dropped=${droppedCount}, downgraded=${downgradedCount}, hardRuleExempt=${hardRuleCount})`)

  // -------------------------------------------------------------------------
  // Critic (deep only)
  // -------------------------------------------------------------------------

  let finalFindings = verifiedFindings

  if (depth === 'deep') {
    phase('Critic')

    const findingSummary = verifiedFindings.map(function(f) {
      return { file: f.file, line: f.line, severity: f.severity, title: f.title }
    })

    agentCount++
    const criticResult = await agent(
      [
        `You are the completeness critic for PR #${prNumber} in ${repoSlug}.`,
        `Read and follow ${promptDir}/completeness-critic.md.`,
        `Existing findings (JSON): ${JSON.stringify(findingSummary)}.`,
        `DIFF_FILE=${diffFile}, WORKTREE_PATH=${wtDisplay}.`,
      ].join(' '),
      {
        label:  'critic',
        model:  'sonnet',
        phase:  'Critic',
        schema: CRITIC_SCHEMA,
      }
    )

    const angles = (criticResult && criticResult.angles) ? criticResult.angles : []
    log(`Critic: ${angles.length} angles to re-examine`)

    if (angles.length > 0) {
      const angleResults = await parallel(angles.map(function(angle) {
        return async function() {
          agentCount++
          const reResult = await agent(
            [
              `You are re-examining a specific review angle for PR #${prNumber} in ${repoSlug}.`,
              `Axis: ${angle.axis} at ${angle.file}:${angle.line}.`,
              `Reason for re-examination: ${angle.reason}.`,
              `Apply the same diff-anchor and verification rules from ${promptDir}/verifier.md.`,
              `Return zero or one finding using DIFF_FILE=${diffFile} and WORKTREE_PATH=${wtDisplay}.`,
            ].join(' '),
            {
              label:  `critic-reexamine:${angle.file}:${angle.line}`,
              model:  'sonnet',
              phase:  'Critic',
              schema: FINDINGS_SCHEMA,
              effort: 'high',
            }
          )

          if (!reResult || !reResult.findings || reResult.findings.length === 0) {
            return []
          }

          // Verify the new finding through the same verifier path
          const newFinding = Object.assign({}, reResult.findings[0])
          newFinding._dimension = `critic:${angle.axis}`

          agentCount++
          const verdict = await agent(verifierPrompt(newFinding), {
            label:  `critic-verify:${newFinding.file}:${newFinding.line}`,
            model:  'sonnet',
            phase:  'Critic',
            schema: VERDICT_SCHEMA,
            effort: 'high',
          })

          if (!verdict || verdict.verdict === 'dropped') {
            droppedCount++
            return []
          }

          if (verdict.verdict === 'downgraded') {
            downgradedCount++
            newFinding.severity = verdict.newSeverity || 'observation'
            newFinding.verifierReasoning = verdict.reasoning
          } else {
            newFinding.verifierReasoning = verdict.reasoning
          }

          return [newFinding]
        }
      }))

      const newFindings = angleResults.flat().filter(Boolean)
      if (newFindings.length > 0) {
        log(`Critic promoted ${newFindings.length} additional finding(s)`)
        finalFindings = dedup(verifiedFindings.concat(newFindings))
      }
    }
  }

  // -------------------------------------------------------------------------
  // Prove: for each Critical finding (excluding hard rules, which are policy
  // violations with no runtime failure to demonstrate), attempt to produce an
  // executable failing test in the worktree. Only runs with a worktree and
  // outside scan depth, and is capped so a pathological finding count can't
  // blow the budget.
  // -------------------------------------------------------------------------

  function proverPrompt(finding) {
    return [
      `You are the proof-of-bug agent for PR #${prNumber} in ${repoSlug}.`,
      `Read and follow ${promptDir}/prover.md.`,
      `FINDING (JSON): ${JSON.stringify(finding)}.`,
      `DIFF_FILE=${diffFile}, CONTEXT_FILE=${contextFile}, WORKTREE_PATH=${worktreePath}.`,
      `You get ONE attempt. Leave the worktree exactly as you found it.`,
    ].join(' ')
  }

  if (worktreePath && depth !== 'scan') {
    const proveCandidates = finalFindings.filter(function(f) {
      return f.severity === 'critical' && !isHardRule(f)
    })

    if (proveCandidates.length > 0) {
      phase('Prove')

      const capped = proveCandidates.slice(0, 5)
      const skipped = proveCandidates.length - capped.length
      if (skipped > 0) {
        log(`Prove: capping at 5 provers, skipping ${skipped} additional critical finding(s)`)
      }

      await parallel(capped.map(function(finding) {
        return async function() {
          agentCount++
          proveAttemptCount++
          const result = await agent(proverPrompt(finding), {
            label:  'prove:' + finding.file + ':' + finding.line,
            phase:  'Prove',
            schema: PROOF_SCHEMA,
            model:  'sonnet',
            effort: 'high',
          })

          if (!result) {
            finding.proof = null
            log(`prove:${finding.file}:${finding.line}: agent returned null`)
            return
          }

          finding.proof = result
          if (result.proven === true) {
            provenCount++
          }
        }
      }))

      log('Prove: ' + provenCount + '/' + proveAttemptCount + ' finding(s) demonstrated with a failing test')
    }
  }

  // Strip internal _dimension field from output
  const output = finalFindings.map(function(f) {
    const clean = Object.assign({}, f)
    delete clean._dimension
    return clean
  })

  return {
    findings:          output,
    droppedCount,
    downgradedCount,
    hardRuleCount,
    agentCount,
    proveAttemptCount,
    provenCount,
    outputTokens:      budget.spent() - budgetAtStart,
    turnTokensTotal:   budget.spent(),
  }
