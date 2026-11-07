#!/usr/bin/env sh
set -eu
ROOT="$(pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo/src" "$T/repo/node_modules" "$T/bin"
if ! git init -q --object-format=sha256 -b main "$T/repo" 2>/dev/null; then
  git init -q -b main "$T/repo"
fi
printf 'linked tools\n' > "$T/repo/node_modules/.sentinel"
git -C "$T/repo" -c user.name=test -c user.email=test@example.com commit -q --allow-empty -m base
printf 'node_modules/\n' > "$T/repo/.gitignore"
printf 'export default []\n' > "$T/repo/eslint.config.mjs"
printf 'const value = 1\n' > "$T/repo/src/a.js"
git -C "$T/repo" add .
git -C "$T/repo" -c user.name=test -c user.email=test@example.com commit -q -m files
git -C "$T/repo" checkout -qb topic
printf 'const value = 2\n' > "$T/repo/src/a.js"
git -C "$T/repo" add .
git -C "$T/repo" -c user.name=test -c user.email=test@example.com commit -q -m change
cat > "$T/bin/npx" <<'SH'
#!/usr/bin/env sh
out=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then out="$2"; shift 2; else shift; fi
done
case "$FAKE_NPX_MODE" in
  clean) printf '[{"filePath":"src/a.js","messages":[]}]' > "$out"; exit 0 ;;
  issues) printf '[{"filePath":"src/a.js","messages":[{"ruleId":"no-unused-vars","severity":2,"line":1}]}]' > "$out"; exit 1 ;;
  dirty) printf '[{"filePath":"src/a.js","messages":[]}]' > "$out"; printf '\n// drift\n' >> src/a.js; exit 0 ;;
  head) printf '[{"filePath":"src/a.js","messages":[]}]' > "$out"; git -c user.name=test -c user.email=test@example.com commit --allow-empty -qm after-lint; exit 0 ;;
  malformed) printf '{}' > "$out"; exit 0 ;;
  exit2-valid) printf '[{"filePath":"src/a.js","messages":[]}]' > "$out"; exit 2 ;;
  *) exit 2 ;;
esac
SH
chmod +x "$T/bin/npx"
run_case() {
  mode="$1"; mkdir -p "$T/out"; out="$T/out/$mode.json"
  PATH="$T/bin:$PATH" FAKE_NPX_MODE="$mode" HOME="$T/home" LEKKER_LOCAL_REPO="$T/repo" LEKKER_BASE_REF=main \
    bash "$ROOT/plugins/olko-github-pr/skills/lekker-review/scripts/setup-worktree.sh" o/r topic "$out" >/dev/null
  node - "$out" "$mode" "$T/repo" <<'NODE'
const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), mode = process.argv[3], repo = process.argv[4]
assert.ok(data.eslintProvenance, `${mode}: ${JSON.stringify(data)}`)
const receipt = JSON.parse(fs.readFileSync(data.eslintProvenance, 'utf8'))
const bytes = fs.readFileSync(data.eslintJson || data.eslintProvenance.replace('.provenance.json', ''))
assert.equal(receipt.reportSha256, crypto.createHash('sha256').update(bytes).digest('hex'), mode)
assert.equal(receipt.baseSha, data.mergeBase)
assert.equal(receipt.headShaBefore, execFileSync('git', ['-C', repo, 'rev-parse', 'topic'], { encoding: 'utf8' }).trim())
if (mode === 'clean' || mode === 'issues') {
  assert.equal(receipt.status, 'available'); assert.equal(receipt.headShaBefore, receipt.headShaAfter)
  assert.equal(receipt.exitCode, mode === 'clean' ? 0 : 1); assert.equal(receipt.trackedCleanAfter, true)
} else {
  assert.equal(receipt.status, 'unavailable'); assert.ok(receipt.reason)
}
if (mode === 'dirty') assert.equal(receipt.trackedCleanAfter, false)
if (mode === 'head') assert.notEqual(receipt.headShaBefore, receipt.headShaAfter)
if (mode === 'fail') assert.equal(receipt.reportSha256, crypto.createHash('sha256').update('').digest('hex'))
if (mode === 'exit2-valid') {
  assert.equal(receipt.exitCode, 2); assert.match(receipt.reason, /ESLint did not complete/)
  assert.ok(data.eslintJson)
}
NODE
  worktree="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).worktreePath' "$out")"
  git -C "$T/repo" worktree remove --force "$worktree"
}
mkdir -p "$T/home"
for mode in clean issues fail malformed dirty head exit2-valid; do run_case "$mode"; done
node - "$T/out" <<'NODE'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const root = process.argv[2]
const outputs = fs.readdirSync(root).filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')))
assert.equal(new Set(outputs.map(data => data.eslintProvenance)).size, outputs.length)
NODE
echo 'PASS: test-lekker-lint-provenance'
