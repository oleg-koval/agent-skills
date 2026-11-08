function isCandidate(row) {
  const original = row.runs.original, defective = row.runs.defective, repaired = row.runs.repaired
  return original?.status === 'observed' && defective?.status === 'observed'
    && original.exitClass === 'success' && defective.exitClass === 'component-limit'
    && (!repaired || repaired.status === 'observed' && repaired.exitCode === 0)
}

export function assembleBoundaryReport({ source, provenance, seed, componentLimit, prefixSha256, suffixSha256,
  cases, results, shrinkResults, outputDir, reduced }) {
  const allResults = [...results, ...shrinkResults]
  const candidates = allResults.filter(isCandidate).map(row => ({ id: row.id, input: row.input,
    evidenceClass: 'composed trusted CLI probe', inputSha256: row.inputSha256,
    outcomes: Object.fromEntries(Object.entries(row.runs).map(([role, result]) => [role, result.exitCode])) }))
  const incomplete = results.length !== cases.length || allResults.length > 100
    || allResults.some(row => row.status !== 'available' || Object.values(row.runs).some(run => run.status !== 'observed'
      || run.exitClass === 'unexpected'))
  return { schema: 1, status: incomplete ? 'unavailable' : 'available', reason: incomplete ? 'timeout, unexpected exit, or incomplete invocation coverage' : null,
    source, provenance, seed, contract: { maxComponentBytes: componentLimit, count: allResults.length,
      validInput: 'nonempty ASCII target slug [a-z0-9-]+; run-log start arguments fixed by adapter',
      prefixSha256, suffixSha256 },
    artifactRoot: outputDir, results: allResults, candidates, reducedCounterexample: reduced ? {
      id: reduced.id, input: reduced.input, inputSha256: reduced.inputSha256,
      method: 'bounded binary search over ASCII prefix lengths',
      scope: 'reduced counterexample; not a proof of global minimality',
      outcomes: Object.fromEntries(Object.entries(reduced.runs).map(([role, result]) => [role, result.exitCode])),
    } : null }
}
