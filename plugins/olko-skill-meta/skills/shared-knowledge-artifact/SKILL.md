---
name: shared-knowledge-artifact
description: Build a shared, self-persisting knowledge ledger as a Claude Artifact — a private page that stores its own data, renders itself from that data, and saves new versions of itself, so several agents can read the same lessons before starting work and append to them afterwards. Use when the user wants agents to learn from each other, asks for a shared knowledge base, lessons-learned log, gotcha ledger, or cross-agent memory page they can hand to other sessions.
license: MIT
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Skill, Artifact
compatibility: Claude Code only — requires the Artifact tool and the artifact runtime capabilities (`capabilities: {artifact: {}}`).
metadata:
  author: Oleg Koval
  package: shared-knowledge-artifact
  tags:
    - artifacts
    - knowledge-base
    - multi-agent
    - memory
    - lessons-learned
    - documentation
---

# shared-knowledge-artifact

Publish one private Artifact page that acts as an append-only knowledge ledger which multiple agents (and the user) read before starting work and write to when reality corrects them. The page **is** the record: it stores its own data and publishes new versions of itself, so nothing depends on a server or on local files.

## Trigger phrases

- create a shared artifact my other agents can learn from
- shared knowledge base / lessons-learned log / gotcha ledger for agents
- cross-agent memory page
- somewhere agents can record what they learned so they don't repeat it

## Before writing any code

1. Invoke the `artifact-capabilities` skill — mandatory before declaring `capabilities` or writing any `window.claude.*` code.
2. Invoke the `artifact-design` skill — calibrates the design treatment.
3. Read the user's actual rules (`CLAUDE.md`, any verification/preferences doc, agent memory) and **seed the ledger with 6-10 real lessons already recorded there**. No lorem, no invented examples — a ledger that opens with fake entries never gets used.

## Persistence mechanism

- Declare `capabilities: {artifact: {}}` at publish time.
- Store the data as a JSON object inside `<script type="application/json" id="ledger-state">`. That block is the authoritative record; the visible page is **rendered from it** at load. Never serialize the live DOM to save.
- To persist: snapshot `document.documentElement.outerHTML` **once at script start** (pristine source, before any rendering), then on save splice the new JSON into that snapshot's `#ledger-state` block, prepend `<!doctype html>`, and call `artifact.publish(doc)`.
- Get the namespace with `const artifact = await claude.use("artifact")`; branch on `null` (this view cannot write) and render a read-only state instead of a broken control.
- Handle publish errors by code: `conflict` means someone published first and every view reloads to the winner — no retry, tell the person to re-add; `not_granted` / `not_writer` means read-only.
- Publish only after an explicit user action, never on load; batch rapid edits into one publish.
- Escape `</script` when writing the JSON back, and escape every interpolated note field on render.

## Note schema

One fact per entry:

```json
{"id":"n9","kind":"lesson|trap|pref","scope":"shell|review|github|...",
 "title":"the rule in one line",
 "body":"the concrete behaviour, specific enough to act on",
 "why":"the failure that made this a rule",
 "author":"model or agent name","date":"YYYY-MM-DD"}
```

Kinds: **lesson** = a habit that holds; **trap** = something that silently produces a *wrong* answer; **pref** = how the user wants the work done.

## UI the page must have

- Header: name, one paragraph on what the ledger is for, and live counts (total, traps, lessons, preferences) in `tabular-nums`.
- Note list, newest first: kind tag, scope tag, author, date, title, body, and a `Why:` line. Kind tags use semantic colour (trap = critical, pref = warning, lesson = accent), separate from the page accent.
- Scope filter chips derived from the data, including an `all` chip, with `aria-pressed` state.
- An "Add a note" form (kind, scope, author, title, body, why) that appends to the JSON and publishes, with an inline status line reporting published / conflict / read-only.
- A "Protocol for agents" section **on the page itself**: read the page with the Artifact tool `action: "read"` before substantive work; parse the `#ledger-state` JSON, never scrape the DOM; **append, don't rewrite**; re-read before writing because another agent may have published since; one fact per note with the failure that caused it. Include the schema snippet.
- Gatekeeping copy: only non-obvious, durable, cross-cutting lessons. If a repo's `CLAUDE.md` already says it, or a review bot already catches it, leave it out — a littered ledger is worse than a thin one.

## Design constraints

- Utilitarian but genuinely polished: this is a reference document, not a landing page. No oversized hero, no emoji section markers, no gradient hero, no everything-centered layout.
- Avoid the AI-default looks: warm cream + serif + terracotta, near-black + acid green, Inter or Space Grotesk as the "safe" face.
- Pair a display face, a body face, and a mono utility face from Google Fonts (the only permitted external host), each with a real fallback stack.
- Theme-aware in all three states: full light palette as tokens on bare `:root`; redefined under `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`; redefined again under `:root[data-theme="dark"]`. Style everything through tokens and give `body` an explicit token background. No colour whose only definition sits inside a media or `[data-theme]` block.
- Layout with flex/grid + `gap`, not per-element margins. Wide content in its own `overflow-x: auto` container. Visible focus states. Respect `prefers-reduced-motion`.
- Title: a short, specific noun-phrase product name (2-4 words), no dash-explainer. Pass a one-sentence `description` and an emoji `favicon`, and keep both stable across redeploys.

## Deliverable

Write the HTML to a file, publish it with the Artifact tool, then report:

- the URL;
- that it stays private until shared from the page's share menu;
- the exact instructions another agent needs — read via Artifact `action: "read"` with that URL, and write by appending to `notes` and republishing **with `url` set to that URL** (a publish *without* `url` forks a separate artifact instead of updating this one).

## Notes

- The full copy-paste prompt version of this workflow lives in `references/prompt.txt` — hand it to another agent or session verbatim.
- Redeploy by republishing the same file path in the same conversation, or by passing `url` from any other conversation.
