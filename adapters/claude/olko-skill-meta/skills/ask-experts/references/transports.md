# Transports and portability

Use a coordinator-mediated file exchange: independent proposals first, followed
by mutual critique and exact-plan approval. This preserves independence, makes
agreement auditable and lets another harness resume from the artifacts. Direct
expert chat is optional; relay its messages through the coordinator's record.

## Harnesses

The coordinator may run in Codex, Claude Code, OpenCode, Hermes, or any agent
that can load Markdown and call two model backends. Its own model need not be
one of the experts. Do not represent two same-model subagents as two families.

Install the whole `ask-experts` folder, including `references/`, in a discovered
skill directory. Use the host's installer or a non-overwriting link/copy:

| Coordinator | Conventional user skill directory |
| --- | --- |
| Codex | `~/.codex/skills/ask-experts` |
| Claude Code | `~/.claude/skills/ask-experts` |
| OpenCode | `~/.config/opencode/skills/ask-experts` |
| Hermes | active profile's `skills/ask-experts`, commonly `~/.hermes/skills/ask-experts` |

Verify discovery in the installed version/profile. If a host cannot discover
skills, explicitly load `SKILL.md` by path. That is manual compatibility, not
proof of native integration. Do not modify global instructions to force loading.

## Expert calls

Prefer headless processes to typing into an interactive agent. Verified on
claude CLI 2.1.325 and codex-cli 0.169.0 (2026-11-16); re-check `--help` on other
versions. These shapes are not verified model IDs or authorization to relax
permissions:

```sh
claude -p --model "$ANTHROPIC_MODEL" --tools "" --strict-mcp-config --disallowedTools "mcp__*" --no-session-persistence --output-format json < request.md > response.json
codex exec --model "$OPENAI_MODEL" -c model_reasoning_effort=high --sandbox read-only --ephemeral --skip-git-repo-check --ignore-user-config -o response.txt - < request.md > run.log 2> run.err
```

Before launching, the coordinator sets `ANTHROPIC_MODEL` and `OPENAI_MODEL` from
the resolved bindings and checks each is non-empty; an unset variable must stop
the run, not fall back to a default model.

- Claude: the answer is the JSON field `result`; the resolved model is the key
  under `modelUsage`; check `is_error` and `stop_reason`. Without
  `--strict-mcp-config` the user's configured MCP servers may load.
- Codex: the answer is the file written by `-o` (final message only); the stderr
  header prints `model:` and `provider:` as identity evidence. Run from the
  scratch directory. `--ignore-user-config` discards `~/.codex/config.toml`,
  including any provider or gateway route; if the account reaches OpenAI through
  such a route, drop the flag and pass the needed settings with `-c key=value`
  so the call uses the intended provider.
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:33dccd2b7b18068bd53f8abeb4f238ef95fd092aaebd78a123a91136dd7fff4c -->

- Inventory without a paid call: read `${CODEX_HOME:-$HOME/.codex}/models_cache.json`
  (keys `models[].slug`, `display_name`, `visibility`, `supported_reasoning_levels`).
  Check `fetched_at`; missing or older than 24 hours means refresh first, or
  disclose the cache age as an identity limit. Freshness does not verify the
  account or provider: before binding, refresh the Codex catalog under the active
  account and intended provider configuration. If that refresh is impossible,
  disclose that the cache's account/provider identity is unverified, regardless
  of age; never silently bind from a stale or identity-unverified cache.

<!-- /coderabbit-ai-generated:v1 -->
- Reasoning effort: do not run at the lowest effort; `high` is a sensible default
  for planning.

Use a private scratch working directory containing only the supplied evidence,
with minimal tool access and the host's normal approvals. Capture stderr
separately. Parse the final assistant message from JSON/event output; retain
provider identity metadata and raw output. Do not send wrappers or progress logs
back as expert reasoning. Apply deadlines through the host process supervisor.
Neither expert needs write access to the project or shared run directory.

### Running the calls

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:18f5b7c92718aa03e1b15aacd6a7634f5b2c932a2ded3ad6e799819db18ce128 -->

Launch both experts from ONE foreground shell call: each as a backgrounded
subshell that writes `<name>.exit` when done, then `wait`, with the call's timeout
above the per-call timeout. Do not use the harness's `run_in_background` for the
launcher: it returns immediately while the children still run, which looks like
completion. If it was used, wait on the `.exit` files, not the launcher's
notification. Use distinct paths for every attempt, including retries (for
example, include expert, cycle and attempt in each filename), for `.exit`,
response and log files. Never reuse a timed-out attempt's paths: its child may
still write to them. Check the current attempt's `.exit` and a non-empty response
file before parsing.

<!-- /coderabbit-ai-generated:v1 -->
Save each raw response next to its request and put the `shasum -a 256` digest of
the exact candidate file in the prompt.

OpenCode can list configured models with `opencode models` and make headless
calls through `opencode run --model provider/model`. Hermes provides model and
provider overrides through `hermes chat`; inspect its installed CLI reference
for one-shot input/output flags. These can replace either expert transport when
the correct provider family is accessible. Check tools and permissions too;
a model flag alone does not make a coding harness read-only. Do not run a
second paid smoke prompt merely to discover access: the first proposal call
can establish availability and capture identity. Explicitly report any fallback.

## Terminals and orchestration shells

Agterm, Herdr, Kitty, Ghostty (also spelled "ghosty" by users), iTerm2, WezTerm,
Terminal.app and tmux can host the coordinator and expert CLIs. The protocol
requires no terminal-specific API. A terminal cannot supply a missing model.
Use its native launch/split support only if available and desired; do not install
remote-control hooks or change security settings. If interactive input is
unavoidable, verify the target pane ID, working directory, model and visible
input readiness immediately before sending anything. Preserve unrelated sessions.
Report shell portability separately from testing a specific terminal integration.

## Authoritative references

Verify these when installed behavior differs; consult only the relevant page:

- [Claude CLI](https://code.claude.com/docs/en/cli-reference)
- [Fable model ID](https://platform.claude.com/docs/en/models/fable-5-2/overview)
- [Codex source and CLI](https://github.com/openai/codex)
- [OpenCode skills and discovery](https://opencode.ai/docs/skills/)
- [Hermes CLI](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)
- [Herdr agent integration](https://herdr.dev/docs/agents/)
