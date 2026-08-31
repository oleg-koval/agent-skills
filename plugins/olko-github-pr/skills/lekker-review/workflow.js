export const meta = {
  name: 'lekker-review-core',
  description: 'Parallel specialist PR review with per-finding adversarial verification',
  phases: [ { title: 'Review' }, { title: 'Verify' }, { title: 'Critic' }, { title: 'Prove' } ],
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const FINDINGS_ARRAY_SCHEMA = {
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
      rule:        { type: 'string', minLength: 1, pattern: '\\S' },
    },
  },
}

const MOCK_SMELLS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['file', 'line', 'description', 'fix'],
    properties: {
      file:        { type: 'string' },
      line:        { type: 'integer' },
      description: { type: 'string' },
      fix:         { type: 'string' },
    },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: FINDINGS_ARRAY_SCHEMA,
    acCoverage:      { type: 'string' },
    mutationSlip:    { type: 'string' },
    coverageVerdict: { type: 'string' },
    mockSmells: MOCK_SMELLS_SCHEMA,
  },
}

const IMPLEMENTATION_SCHEMA = {
  type: 'object',
  required: ['findings', 'acCoverage'],
  properties: {
    findings: FINDINGS_ARRAY_SCHEMA,
    acCoverage: { type: 'string' },
  },
}

const TEST_QUALITY_SCHEMA = {
  type: 'object',
  required: ['findings', 'coverageVerdict', 'mutationSlip', 'mockSmells'],
  properties: {
    findings: FINDINGS_ARRAY_SCHEMA,
    coverageVerdict: { type: 'string' },
    mutationSlip: { type: 'string' },
    mockSmells: MOCK_SMELLS_SCHEMA,
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
  required: ['attempted', 'proven', 'outcome', 'reason'],
  properties: {
    attempted:   { type: 'boolean' },
    proven:      { type: 'boolean' },
    outcome:     { enum: ['proven', 'passed', 'inconclusive', 'not_attempted'] },
    reason:      { type: 'string' },
    testCode:    { type: 'string' },
    testCommand: { type: 'string' },
    redOutput:   { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHardRule(finding) {
  return typeof finding.rule === 'string' && finding.rule.trim().length > 0
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
    for (const field of ['verificationStatus', 'verifierReasoning', 'proof']) {
      if (Object.prototype.hasOwnProperty.call(b, field)) {
        merged[field] = b[field]
      } else {
        delete merged[field]
      }
    }
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

// How far apart two anchor lines may be and still count as the same issue.
// Reviewers routinely anchor one defect at different lines: the loop header,
// the body, the function signature. Kept tight enough that two genuinely
// distinct findings in one file are not merged because their titles rhyme.
const SAME_ISSUE_LINE_WINDOW = 30

function nearbyLines(a, b) {
  const la = Number(a.line)
  const lb = Number(b.line)
  if (!Number.isFinite(la) || !Number.isFinite(lb)) {
    // A finding with no usable line (a PR-level note) only merges with another
    // one at the same missing line, which is what strict equality gives.
    return a.line === b.line
  }
  return Math.abs(la - lb) <= SAME_ISSUE_LINE_WINDOW
}

// Would adding `candidate` keep the whole group inside the window? Uses the
// group's min and max so the answer never depends on arrival order.
function spanWithinWindow(group, candidate) {
  const lines = group.concat([candidate]).map(function(f) { return Number(f.line) })
  if (!lines.every(function(n) { return Number.isFinite(n) })) {
    // Any unusable line falls back to the strict pairwise rule.
    return group.every(function(m) { return nearbyLines(m, candidate) })
  }
  return Math.max.apply(null, lines) - Math.min.apply(null, lines) <= SAME_ISSUE_LINE_WINDOW
}

function dedup(allFindings) {
  // Bucket by FILE, not by `file:line`. Bucketing on the exact line meant two
  // reviewers describing one defect at lines 9 and 14 landed in different
  // buckets, so `sameIssue` was never consulted: the issue was verified twice,
  // burning two verifier agents and emitting two inline comments for one
  // problem, which is exactly what this pass exists to prevent.
  const byLocation = new Map()
  for (const f of allFindings) {
    const key = String(f.file)
    if (!byLocation.has(key)) {
      byLocation.set(key, [])
    }
    byLocation.get(key).push(f)
  }

  const result = []
  for (const candidates of byLocation.values()) {
    const groups = []
    for (const candidate of candidates) {
      // Compare against the whole group's SPAN, not just its first member.
      // Checking only g[0] made grouping order-dependent: findings at 25, 50
      // and 1 all joined when 25 arrived first, leaving a group spanning 49
      // lines despite a 30-line window.
      const match = groups.find(function(g) {
        return sameIssue(g[0], candidate) && spanWithinWindow(g, candidate)
      })
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

function shouldVerify(finding) {
  // Review depth controls breadth, not the trust bar. Every finding that can
  // affect the verdict must be checked. Hard rules take the verifier's
  // rule-specific anchor/applicability path instead of its runtime challenges.
  return finding.severity === 'critical' || finding.severity === 'important'
}

function normalizeProof(result) {
  const hasText = function(value) {
    return typeof value === 'string' && value.trim().length > 0
  }
  const coherent = (
    result.attempted === true
    && result.proven === true
    && result.outcome === 'proven'
    && hasText(result.testCode)
    && hasText(result.testCommand)
    && hasText(result.redOutput)
  ) || (
    result.attempted === true
    && result.proven === false
    && result.outcome === 'passed'
    && hasText(result.testCode)
    && hasText(result.testCommand)
  ) || (
    result.attempted === true
    && result.proven === false
    && result.outcome === 'inconclusive'
  ) || (
    result.attempted === false
    && result.proven === false
    && result.outcome === 'not_attempted'
  )

  if (coherent) {
    return result
  }

  const attempted = result.attempted === true
  return {
    attempted,
    proven: false,
    outcome: attempted ? 'inconclusive' : 'not_attempted',
    reason: `Prover returned an inconsistent proof state; ignored. ${result.reason || ''}`.trim(),
  }
}

// Run thunks in sequential batches, giving the per-finding stages a ceiling.
//
// The review stage is bounded by its dimension count, but verify, critic and
// prove spawn one agent per finding: a PR with thirty findings would otherwise
// launch thirty concurrent agents in a single call. This caps them without
// changing results.
//
// `plan` gives the size of each successive batch and its final entry repeats
// to cover any remainder, so a plan of [5] means "five at a time, forever".
// Return value matches parallel(): input order preserved, a failed thunk
// resolves to null rather than rejecting the batch.
async function batched(thunks, plan) {
  if (thunks.length === 0) {
    return []
  }

  const sizes = (plan && plan.length > 0) ? plan : [thunks.length]
  const out = []
  let index = 0
  let batchNo = 0

  while (index < thunks.length) {
    const size = Math.max(1, sizes[Math.min(batchNo, sizes.length - 1)])
    const slice = thunks.slice(index, index + size)
    const results = await parallel(slice)
    for (const r of results) {
      out.push(r)
    }
    index += slice.length
    batchNo++
    log(`batch ${batchNo}: ${slice.length} agent(s) done (${index}/${thunks.length})`)
  }

  return out
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
  reviewBatchPlan,
  maxConcurrent,
} = input

if (!repoSlug || !prNumber || !depth || !diffFile || !contextFile || !promptDir) {
  throw new Error(
    'lekker-review workflow: missing required args (got type ' + typeof args +
    '): ' + JSON.stringify({ repoSlug, prNumber, depth, diffFile, contextFile, promptDir })
  )
}

// Concurrency. The review stage is self-limiting: five dimensions means five
// agents, so it runs them all at once. The other stages are not. Verify,
// critic and prove spawn one agent PER FINDING, so a finding-heavy PR would
// fan out far wider than the review that produced it, with no ceiling. Those
// are capped at the review stage's own width.
const REVIEW_PLAN = (Array.isArray(reviewBatchPlan) && reviewBatchPlan.length > 0)
  ? reviewBatchPlan
  : [5]
const FANOUT_PLAN = [Math.max(1, maxConcurrent || 5)]

log(`args ok: PR #${prNumber} in ${repoSlug}, depth=${depth}, reviewPlan=[${REVIEW_PLAN}], fanout=${FANOUT_PLAN[0]}`)

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
      `HOUSE_RULES_FILE: read key "houseRulesFile" from CONTEXT_FILE, then read that exact path before validating a hard rule.`,
      `Default to dropping when uncertain.`,
    ].join(' ')
  }

  // -------------------------------------------------------------------------
  // Review stage: run all dimensions in parallel via pipeline
  // -------------------------------------------------------------------------

  async function reviewStage(dim) {
    agentCount++
    let schema = FINDINGS_SCHEMA
    if (dim.key === 'implementation') {
      schema = IMPLEMENTATION_SCHEMA
    } else if (dim.key === 'test-quality') {
      schema = TEST_QUALITY_SCHEMA
    }
    const result = await agent(reviewPrompt(dim), {
      label:  `review:${dim.key}`,
      phase:  'Review',
      schema,
      model:  dim.model,
    })

    if (!result) {
      log(`${dim.key}: agent returned null, skipping`)
      return { key: dim.key, findings: [] }
    }

    const findings = (result.findings || []).map(function(f) {
      const copy = Object.assign({}, f)
      copy._dimension = dim.key
      return copy
    })

    log(`${dim.key}: ${findings.length} findings, ${
      findings.filter(function(f) { return shouldVerify(f) }).length
    } to verify`)

    return {
      key: dim.key,
      findings,
      acCoverage: dim.key === 'implementation' ? result.acCoverage : undefined,
      coverageVerdict: dim.key === 'test-quality' ? result.coverageVerdict : undefined,
      mutationSlip: dim.key === 'test-quality' ? result.mutationSlip : undefined,
      mockSmells: dim.key === 'test-quality' ? result.mockSmells : undefined,
    }
  }

  // -------------------------------------------------------------------------
  // Verify stage: takes the deduped cross-dimension finding set, splits into
  // in-scope (verdict-affecting) and out-of-scope (non-blocking), and runs
  // verifiers in parallel over the in-scope set. Hard rules use the verifier's
  // rule-specific checks and skip only its runtime-oriented challenges.
  // -------------------------------------------------------------------------

  async function verifyAll(findings) {
    const inScope = findings.filter(function(f) {
      return shouldVerify(f)
    })
    const outOfScope = findings.filter(function(f) {
      return !shouldVerify(f)
    })

    if (inScope.length === 0) {
      return outOfScope
    }

    const verified = await batched(inScope.map(function(finding) {
      return async function() {
        agentCount++
        if (isHardRule(finding)) {
          hardRuleCount++
        }

        const verdict = await agent(verifierPrompt(finding), {
          label:  `verify:${finding.file}:${finding.line}`,
          model:  'sonnet',
          phase:  'Verify',
          schema: VERDICT_SCHEMA,
          effort: 'high',
        })

        if (!verdict) {
          // Missing verification cannot support a blocking finding.
          downgradedCount++
          const kept = Object.assign({}, finding)
          kept.severity = 'observation'
          kept.verificationStatus = 'unavailable'
          kept.verifierReasoning = 'verifier agent returned no usable result; downgraded to non-blocking'
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
          downgraded.verificationStatus = 'downgraded'
          downgraded.verifierReasoning = verdict.reasoning
          return downgraded
        }

        // confirmed
        const confirmed = Object.assign({}, finding)
        confirmed.verificationStatus = isHardRule(finding) ? 'hard-rule-confirmed' : 'confirmed'
        confirmed.verifierReasoning = verdict.reasoning
        return confirmed
      }
    }), FANOUT_PLAN)

    return outOfScope.concat(verified.filter(Boolean))
  }

  // -------------------------------------------------------------------------
  // Review -> dedup -> verify: all reviewers run to completion (barrier),
  // then findings are deduped once across dimensions, then the unique set is
  // verified. This avoids burning two verifier agents (and risking two
  // contradictory verdicts) on the same issue found by two dimensions.
  // -------------------------------------------------------------------------

  phase('Review')

  log(`Review: ${dimensions.length} dimension(s) in batches of [${REVIEW_PLAN}]`)

  const reviewed = await batched(dimensions.map(function(dim) {
    return function() { return reviewStage(dim) }
  }), REVIEW_PLAN)

  const reviewResults = reviewed.filter(Boolean)
  const implementationResult = reviewResults.find(function(result) {
    return result.key === 'implementation'
  }) || {}
  const testQualityResult = reviewResults.find(function(result) {
    return result.key === 'test-quality'
  }) || {}
  const deduped = dedup(reviewResults.flatMap(function(result) {
    return result.findings
  }))

  log(`${deduped.length} unique finding(s) after dedup; verifying ${
    deduped.filter(function(f) { return shouldVerify(f) }).length
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
      const angleResults = await batched(angles.map(function(angle) {
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

          if (isHardRule(newFinding)) {
            hardRuleCount++
          }

          if (verdict.verdict === 'downgraded') {
            downgradedCount++
            newFinding.severity = verdict.newSeverity || 'observation'
            newFinding.verificationStatus = 'downgraded'
            newFinding.verifierReasoning = verdict.reasoning
          } else {
            newFinding.verificationStatus = isHardRule(newFinding) ? 'hard-rule-confirmed' : 'confirmed'
            newFinding.verifierReasoning = verdict.reasoning
          }

          return [newFinding]
        }
      }), FANOUT_PLAN)

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

      await batched(capped.map(function(finding) {
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

          const proof = normalizeProof(result)
          finding.proof = proof
          if (proof.proven === true) {
            provenCount++
            finding.verificationStatus = 'proven'
          } else if (proof.outcome === 'passed') {
            downgradedCount++
            finding.severity = 'important'
            finding.verificationStatus = 'counter-evidence'
            finding.verifierReasoning = [
              finding.verifierReasoning,
              `Proof test passed: ${proof.reason}`,
            ].filter(Boolean).join(' ')
          }
        }
      }), FANOUT_PLAN)

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
    acCoverage:        implementationResult.acCoverage || null,
    coverageVerdict:   testQualityResult.coverageVerdict || null,
    mutationSlip:      testQualityResult.mutationSlip || null,
    mockSmells:        Array.isArray(testQualityResult.mockSmells) ? testQualityResult.mockSmells : [],
    outputTokens:      budget.spent() - budgetAtStart,
    turnTokensTotal:   budget.spent(),
  }
