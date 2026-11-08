# Boundary probe evidence

Boundary probing is opt-in. It is not enabled for PRs by default and does not
accept arbitrary command strings from PR content. The registered Node filename
operation executes a trusted source captured from the exact base and head
commits named by observed Git evidence, using a fixed CLI protocol. A repaired
commit is optional and must be named in the local configuration.

Create a local JSON configuration outside the reviewed worktree:

```json
{
  "schema": 1,
  "trustedRoot": "/absolute/path/to/trusted/repository",
  "repoSlug": "agent-skills",
  "seed": 20261108,
  "maxInputs": 32,
  "suffix": "",
  "repairedCommit": "<optional exact 40-character commit SHA>"
}
```

Use the existing evidence-bundle helper with explicit local consent:

```sh
node "<SKILL_ROOT>/scripts/evidence-bundle.mjs" \
  --worktree "<scratchpad>/worktree.json" \
  --trusted-boundary-opt-in \
  --boundary-config "<local-config.json>" \
  --boundary-out "<scratchpad>/boundary-artifacts"
```

The adapter independently recollects Git evidence and requires the fixed
`run-log.mjs` path in the observed changed-path list. It observes the filesystem
component limit in the output filesystem, uses only nonempty ASCII slug inputs,
and accepts 8–88 generated inputs (plus bounded reduction) per run, never more
than 100 invocations per source, with a five-second invocation timeout.
The generated report records the seed, full inputs and hashes, exact source
commits and hashes, adapter/generator hashes, Node version, exit codes, and raw
stdout/stderr artifact paths. An error, timeout, stale identity, invalid input,
missing file, hash mismatch, or exhausted reduction budget is unavailable. The
trusted CLI runs with a minimal environment in a temporary working/state
directory; this is not an operating-system filesystem sandbox, so only opt in
for code already trusted by the operator.

The reduced candidate's raw stderr is rehashed before its fixed `ENAMETOOLONG`
failure code and stderr hash/path enter the compact reviewer packet. A missing,
changed, or escaping stderr artifact makes the boundary capture unavailable.
The evidence is a composed trusted CLI probe. A passing reproduction is an
evidence candidate for human semantic review, never an automatic finding or a
clean verdict. The compact reviewer context retains status, provenance, and
candidate/minimal-input summaries while raw runs remain in the full bundle.
# Explicit filename adapter

Boundary probing stays opt-in. The current adapter can be pointed at a changed
repository-relative Node module with `sourcePath` and the fixed
`node-fs.mkdtempSync.filename` operation. It still invokes only the built-in
`start` CLI protocol; configuration cannot supply commands. Applicability is
manual: no automatic AST or data-flow detection is claimed. Inputs are
nonempty ASCII target slugs; UTF-8 target generation is unsupported. The
independent property is that each valid target produces a component within the
observed filesystem byte limit. Full stdout/stderr, pinned source bytes,
invocation outcomes, and the reduced witness remain in the audit report.

## Shadow evidence projection

`evidence-packet.mjs` projects selected changed-path patches, matching lint
diagnostics, and the compact boundary witness from a saved full bundle. Pass the
full bundle's independently recorded SHA-256, dimension, and exact changed paths.
The packet stays separate from the immutable bundle, rejects hash mismatch,
and fails closed when its byte budget is exceeded. It is opt-in shadow output;
omitted paths and diagnostics remain explicit gaps, and every consumer must
still review the whole diff.
