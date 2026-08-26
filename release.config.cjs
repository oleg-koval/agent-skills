const baseConfig = require('semantic-release-npm-github-publish/release.config.js')
const gitPlugin = baseConfig.plugins[4]

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
    [gitPlugin[0], {
      ...gitPlugin[1],
      assets: [...gitPlugin[1].assets, "plugins/*/.claude-plugin/plugin.json"],
    }],
    ...baseConfig.plugins.slice(5),
  ],
};
