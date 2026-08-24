# Adapter coverage is decided per skill and easy to get wrong

Each skill's `adapters` array in `catalog/skills.json` decides which of the nine targets it
ships to. Coverage today: Claude 48, Grok 46, Cursor 44, Copilot 44, Codex 41, Windsurf 34,
Kiro 34, Pi 2, Hermes 2.

Nothing enforces a policy. A new skill inherits whatever its author typed, so a skill can
silently miss a target its siblings all ship to. Two options worth considering: a default
adapter set applied when a catalog entry omits one, or a validator warning when a skill's
coverage is narrower than its plugin's other skills.
