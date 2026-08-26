const baseConfig = require('semantic-release-npm-github-publish/release.config.js')

/** @type {import('semantic-release').Options} */
module.exports = {
  ...baseConfig,
  branches: [
    "main",
    { name: "beta", channel: "beta", prerelease: "beta" },
  ],
  plugins: [
    ...baseConfig.plugins.slice(0, 4),
    "./scripts/semantic-release-build.cjs",
    ...baseConfig.plugins.slice(4),
  ],
};
