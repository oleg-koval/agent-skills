const { execFileSync } = require('node:child_process')

module.exports = {
  prepare(_pluginConfig, context) {
    execFileSync('npm', ['run', 'build'], {
      stdio: 'inherit',
      env: { ...process.env, RELEASE_VERSION: context.nextRelease.version },
    })
  },
}
