import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runBoundaryProbe } from './boundary-probe-runner.mjs'
import { unavailable } from './boundary-probe-contract.mjs'

function main(argv) {
  const flag = name => { const index = argv.indexOf(`--${name}`); return index < 0 ? null : argv[index + 1] }
  const configPath = flag('config'), worktreePath = flag('worktree'), outputDir = flag('out')
  if (!argv.includes('--trusted-opt-in') || !configPath || !worktreePath || !outputDir) {
    console.error('usage: boundary-probe.mjs --trusted-opt-in --config <trusted.json> --worktree <worktree.json> --out <directory>')
    process.exitCode = 2; return
  }
  try {
    const metadata = JSON.parse(readFileSync(worktreePath, 'utf8'))
    const report = runBoundaryProbe({ config: JSON.parse(readFileSync(configPath, 'utf8')),
      worktreePath: metadata.worktreePath, mergeBase: metadata.mergeBase, headSha: metadata.headSha, outputDir, optIn: true })
    console.log(JSON.stringify(report))
    if (report.status !== 'available') process.exitCode = 1
  } catch { console.log(JSON.stringify(unavailable('probe input could not be read'))); process.exitCode = 2 }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
