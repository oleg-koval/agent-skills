handler.js retries a call up to 3 times and gives each attempt a 5 second timeout.

1. `fn` is called at most 3 times in total: `config.json:1` sets `"retries": 3`, which is the attempt count (1 call plus 2 retries), and the loop at `repo/handler.js:7` runs `config.retries` times.
2. Each attempt is passed a 5 second AbortSignal (honoured only if `fn` uses it): `config.json:1` sets `"timeout_ms": 5000`, passed as `AbortSignal.timeout(config.timeout_ms)` at `repo/handler.js:9`.
3. The loop stops on the first success: `return await fn(...)` at `repo/handler.js:9` exits the function as soon as one attempt resolves.
4. Errors are swallowed: the `catch (e) {` block at `repo/handler.js:10` is empty (closes at line 11), so every failed attempt is silently discarded. If all attempts fail, `withRetry` returns undefined with no error raised (`repo/handler.js:13`). This is the error-handling risk.
