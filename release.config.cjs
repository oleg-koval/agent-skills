/** @type {import('semantic-release').Options} */
module.exports = {
  branches: [
    "main",
    { name: "beta", channel: "beta", prerelease: "beta" },
  ],
  extends: "semantic-release-npm-github-publish",
};
