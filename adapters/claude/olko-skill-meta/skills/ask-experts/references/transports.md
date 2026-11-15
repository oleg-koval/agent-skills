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

Prefer headless processes to typing into an interactive agent. Check installed
`--help` before choosing flags. These are invocation shapes, not verified model
IDs or authorization to relax permissions:

```sh
claude -p --model "$FABLE_MODEL" --tools "" --disallowedTools "mcp__*" --output-format json < request.md > response.json
codex exec --model "$ASTRA_MODEL" --sandbox read-only --ephemeral --skip-git-repo-check - < request.md > response.txt
```

Use a private scratch working directory containing only the supplied evidence,
with minimal tool access and the host's normal approvals. Capture stderr
separately. Parse the final assistant message from JSON/event output; retain
provider identity metadata and raw output. Do not send wrappers or progress logs
back as expert reasoning. Apply deadlines through the host process supervisor.
Neither expert needs write access to the project or shared run directory.

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
