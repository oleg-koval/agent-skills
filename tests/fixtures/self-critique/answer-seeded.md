handler.js retries a call and applies a timeout to each attempt.

1. Retries are 5: `config.json:1` sets `"retries": 5`, and the loop at `repo/handler.js:7` runs that many times.
2. The timeout is 30 seconds: `config.json:1` sets `"timeout_ms": 30000`, passed to the call at `repo/handler.js:9`.
3. The loop stops on the first success: `return await fn(...)` at `repo/handler.js:9` exits as soon as one attempt resolves.
4. The production dashboard shows zero errors for this handler (`repo/handler.js:9`), so error handling is healthy and there is no risk to flag.
