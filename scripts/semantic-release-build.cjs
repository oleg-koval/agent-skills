const { execFileSync } = require('node:child_process')

module.exports = {
  prepare() {
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })
  },
}
