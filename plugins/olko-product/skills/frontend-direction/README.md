# Frontend direction (beta)

Give your coding agent a visual direction before it writes the frontend.

For new pages and substantial redesigns, this skill chooses a composition, selects compatible components, records the decisions and checks the rendered result. Small UI fixes stay within the existing design. The reference catalog includes the seven resources from [Nero's post](https://x.com/neropursue/status/2109514246853677192).

Status: experimental beta. Discovery passes in all four agents. Codex and Claude Code produced functional pages and passed the small-fix case; Codex stated its direction before coding, while Claude did not demonstrate that checkpoint before its first UI edit. This update makes the checkpoint explicit. Pi and Hermes model trials remain deferred because provider authentication is unavailable. See the [evaluation and controlled comparison](../../../../docs/frontend-direction-evaluation-2026-10-19.md). The updated checkpoint still needs a Claude rerun; the current Claude CLI returned `Not logged in` before generating a response.

## Install

The skill ships in the `olko-product` plugin. In Claude Code:

```
/plugin marketplace add oleg-koval/agent-skills
/plugin install olko-product@olko-agent-skills
```

For Codex, Pi, Hermes and the other agents, follow the install steps for that agent in the [repository README](../../../../README.md).

## Activate before frontend work

Start a new session after installation. Explicit invocation avoids relying on the model to select the skill:

| Agent | Prompt |
| --- | --- |
| Pi | `/skill:frontend-direction Build this page; choose the direction before coding.` |
| Codex | `$frontend-direction Build this page; choose the direction before coding.` |
| Claude Code | `/olko-product:frontend-direction Build this page; choose the direction before coding.` |
| Hermes | `/frontend-direction Build this page; choose the direction before coding.` |

For routine use, add this instruction to the project's active agent instructions: `AGENTS.md` for Codex and Pi, `CLAUDE.md` for Claude Code, and the active project context file for Hermes. Hermes can prioritize `.hermes.md` or `AGENTS.override.md` over `AGENTS.md`; put the rule in the file actually loaded.

> Before editing UI implementation files for a new page or substantial redesign, load and follow the installed frontend-direction skill. State the chosen composition, visual anchors, component choices and sources, and a relevant rejected alternative. Then continue without waiting for approval unless a design checkpoint was requested. For small UI fixes, use its lightweight path and preserve the existing design. If the skill is unavailable, report that and use the project's existing design guidance.

This is an instruction-level requirement, not a runtime enforcement hook. Check that the agent actually loads the skill and states a direction on the first frontend task. Do not assume discovery proves usage or visual quality. Installing the plugin does not modify project instructions.

## Compatibility sources

One portable skill folder serves all four agents. The workflow uses capabilities rather than vendor tool names, and keeps automatic discovery enabled. Browsing and browser inspection remain optional capabilities with explicit verification limits.

- [Pi skill discovery and explicit invocation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [Pi configuration directory](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/config.ts)
- [Codex skills](https://developers.openai.com/codex/skills/)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Hermes skills and profiles](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)
- [Hermes project context](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files/)

Record the installed plugin version when reporting results. For reproducible trials, keep the same installed copy throughout the comparison.

## What to evaluate

Use the same brief, content, model and budget with and without the skill. Compare hierarchy, coherence, task clarity, distinctiveness, mobile behavior and dependency cost. Save the selected direction and screenshots. Include a small-edit case to check that the skill does not force a redesign. Report browser-verification limits honestly.

Only this skill folder is installed; no component library or paid resource is installed automatically.
