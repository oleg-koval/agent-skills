# OpenRewrite native JavaScript pilot

This optional fixture experiment runs a shipped OpenRewrite recipe without the
Moderne CLI. It adds no default review dependency and applies no source fixes.
It tests a concrete static-analysis opportunity while all six semantic review
dimensions and Verify/Critic/Prove remain required.

## Reproduce in isolation

Requires npm and Docker. Run from this repository's root. Installation disables
package lifecycle scripts. The recipe runs with no network, host mounts or
forwarded credentials; only the temporary fixture project enters the container.

```sh
pilot_dir=$(mktemp -d)
npm install --prefix "$pilot_dir" --ignore-scripts --omit=optional \
  --no-audit --no-fund --save-exact @openrewrite/rewrite@8.100.3
cp tests/openrewrite-pilot.mjs "$pilot_dir/pilot.mjs"
pilot_container=$(docker create --network none --cap-drop ALL \
  --security-opt no-new-privileges --memory 1g --pids-limit 128 --workdir /work \
  node@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 \
  node pilot.mjs)
docker cp "$pilot_dir/." "$pilot_container:/work"
docker start -a "$pilot_container" > "$pilot_dir/first.stdout" 2> "$pilot_dir/first.stderr"
docker inspect "$pilot_container" --format '{{.State.ExitCode}}'
docker cp "$pilot_container:/work/artifacts" "$pilot_dir/first-artifacts"
docker start -a "$pilot_container" > "$pilot_dir/second.stdout" 2> "$pilot_dir/second.stderr"
docker inspect "$pilot_container" --format '{{.State.ExitCode}}'
docker cp "$pilot_container:/work/artifacts" "$pilot_dir/second-artifacts"
```

Both exit codes must be zero. Each process checks its two fresh-input passes
for identical normalized output and validates every expected result. Compare
the `outputSha256` values across the two stdout files as a separate cold-process
repeatability gate. Preserve stderr, package-lock.json, expectations, outputs and
patches before removing the stopped container and temporary directory. A failed
process is unavailable evidence, never a clean review. No fixtures execute the
JavaScript being analyzed.

## Frozen experiment

Package: `@openrewrite/rewrite@8.100.3`.
Tested runtime: Node v22.23.4 in the pinned Linux/arm64 container image above.
Recipe: `org.openrewrite.javascript.cleanup.async-callback-in-sync-array-method`.
The harness uses the package's JavaScriptParser, scheduleRun and TreePrinters;
it implements no substitute detection rule.

| Fixture | Expected and observed |
|---|---|
| Array.filter with async callback | Warning |
| Array.forEach with async callback | Warning |
| Array.filter with sync callback | Unchanged |
| Array.map with async callback | Unchanged |
| Typed custom filter accepting async callback | Unchanged |
| Known-safe custom filter with erased receiver type | Warning: characterized false positive |
| Invalid TypeScript syntax | Parse-error / unavailable |

The extra untyped custom filter returns the callback's promise to its caller;
unlike Array.filter, it never interprets that promise as a boolean. The warning
is therefore not a demonstrated defect. Its expected warning characterizes the
recipe's limitation, not a passing semantic-quality gate. The `any` annotation
exists only to make the lost type attribution explicit in this isolated fixture.

The original six-fixture 7 November 2026 pilot passed in two cold processes with two
passes each. All four normalized outputs matched SHA-256
`ae1a6381c263289b5d006eda96cd73e87d1c9f5cbb95040fdb7c3e916d410bb9`.
Pass times were 3492/3078 ms and 2880/2136 ms, excluding image/npm setup,
container startup and coordinator work. These tiny-fixture timings establish
neither repository-scale speed nor whole-review savings. The local raw archive
is `~/.local/state/lekker-review-evaluation/runs/20261107-openrewrite-native`.
The wrapper checks the package version; the retained lockfile pins transitive
dependencies for that historical run. A fresh install may resolve different
transitives and is a new experiment, not an exact historical replay.
The expanded seven-fixture run also makes the forEach callback suspend before
checking whether its work finished. Including the safe untyped receiver, it produced
`52ba49e0a0fdc5a7fb0ad13574e04f11a102c19b029cf2e41d95bfab460e2613`.

## Adoption limits

This proves one recipe/version on synthetic fixtures, not population recall or
false-positive rates. A false positive on a safe untyped receiver was observed;
warnings need semantic verification. Preserve parse failures as unavailable.
Printed markers/patches are evidence only; do not auto-apply them. The fixture
runner is opt-in and intentionally absent from the normal dependency-free suite.

The native package route worked without authentication; this does not prove
every recipe works without Java/RPC or change the documented Moderne CLI's
authentication requirements. The JavaScript package uses the Moderne Source
Available License, distinct from Apache-licensed OpenRewrite core. No package
redistribution or mandatory production integration is proposed here.

References: [JavaScript development environment](https://docs.openrewrite.org/authoring-recipes/javascript-recipe-development-environment),
[recipe testing example](https://docs.openrewrite.org/authoring-recipes/writing-a-javascript-refactoring-recipe),
and [licensing](https://docs.openrewrite.org/licensing/openrewrite-licensing).
