# CI step order is what keeps the idempotence test honest

`tests/test-generation-idempotent.sh` exits 0 with a SKIP when the working tree is dirty, because
it cannot assert generation cleanliness against uncommitted changes. That is deliberate for local
use, but it means the test is a no-op on a dirty tree.

In CI this is currently safe only because of ORDERING. The `test` job in
`.github/workflows/ci-release.yml` runs `npm run build`, then a `Generated tree is clean` step
(`git diff --exit-code`), and only then `npm test`. A dirty tree fails at the diff step and never
reaches the SKIP branch.

If those steps are ever reordered, or the diff step is removed, the idempotence test silently
degrades to a no-op and stale generated output can ship. Options: assert non-dirty as a hard
failure inside the test when an env var like `CI` is set, or fold the diff check into the test
itself so the guarantee does not depend on job ordering.
