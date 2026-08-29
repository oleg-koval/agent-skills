#!/bin/sh
# Smoke-tests the two scripts that read the catalog but have no other coverage:
# sync-from-sources.sh (a no-op today, so only its parse and catalog access are exercised)
# and site/build.mjs (the Pages generator, which crashed silently on a catalog shape change).
set -eu

# shellcheck disable=SC1007  # CDPATH= is a deliberate empty assignment for this idiom
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $1" >&2; exit 1; }

# Snapshot the plugin tree before running, so uncommitted work in progress cannot
# masquerade as the script having written something. Asserting an empty status here
# instead makes this test fail for anyone with a dirty tree, which is a false alarm:
# what matters is that the script changes nothing, not that the tree started clean.
plugins_before="$(git status --porcelain plugins)"

# sync-from-sources.sh must parse, run, and report the no-op rather than erroring.
out="$(./scripts/sync-from-sources.sh 2>&1)" || fail "sync-from-sources.sh exited non-zero: $out"
case "$out" in
  *"nothing to sync"*) ;;
  *) fail "sync-from-sources.sh unexpected output: $out" ;;
esac

# It must not have written into the plugin tree.
if [ "$(git status --porcelain plugins)" != "$plugins_before" ]; then
  fail "sync-from-sources.sh modified the plugin tree while no sourcePath is configured"
fi

# site/build.mjs must build, and its counts must match the catalog rather than being hardcoded.
site_out="$(node site/build.mjs 2>&1)" || fail "site/build.mjs exited non-zero: $site_out"
skills="$(node --input-type=module -e 'const {loadCatalog}=await import("./scripts/lib/catalog.mjs");console.log(loadCatalog().skills.length)')"
plugins="$(node --input-type=module -e 'const {loadCatalog}=await import("./scripts/lib/catalog.mjs");console.log(loadCatalog().plugins.length)')"
# Match the summary line exactly, not as a substring: a loose match passes on
# output like "site: 999 fake 48 skills" because it still contains "48 skills".
expected="site: $skills skills, $plugins categories, 9 adapters -> _site/"
if [ "$site_out" != "$expected" ]; then
  fail "site build summary mismatch
  expected: $expected
  actual:   $site_out"
fi

test -f _site/index.html || fail "site build produced no _site/index.html"
test -f _site/assets/catalog.css || fail "site build produced no catalog stylesheet"
test -f _site/assets/catalog.js || fail "site build produced no catalog script"

# The built site must not reference the deleted layout.
if grep -q 'packages/' _site/index.html; then
  fail "_site/index.html references the deleted packages/ layout"
fi

grep -q '/plugin install olko-product@olko-agent-skills' _site/index.html || \
  fail "site does not render plugin-specific marketplace installation"
grep -q 'https://www.olegkoval.com' _site/index.html || \
  fail "site does not link to the Oleg Koval portfolio"
grep -q 'data-consent-banner' _site/index.html || \
  fail "site does not render analytics consent controls"
grep -q 'skillsDataLayer' _site/assets/catalog.js || \
  fail "site analytics does not use the dedicated skills data layer"
grep -q 'skills.olegkoval.com' _site/assets/catalog.js || \
  fail "site analytics does not guard production collection by hostname"
grep -q 'G-NV8Q2H8YV0' _site/index.html || \
  fail "site does not use the olegkoval.com GA4 measurement id"
grep -q '/plugin install olko-product@olko-agent-skills' _site/skills/product-builder/index.html || \
  fail "skill detail page does not install its owning plugin"

echo "PASS: test-scripts-smoke (sync no-op, site $skills skills / $plugins plugins)"
