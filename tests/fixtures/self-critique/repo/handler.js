const fs = require("fs");
const path = require("path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

async function withRetry(fn) {
  for (let i = 0; i < config.retries; i++) {
    try {
      return await fn(AbortSignal.timeout(config.timeout_ms));
    } catch (e) {
    }
  }
}

module.exports = { withRetry };

if (require.main === module) {
  withRetry(async () => "ok");
}
