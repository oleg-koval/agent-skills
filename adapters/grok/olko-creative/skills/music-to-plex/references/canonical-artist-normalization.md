# Canonical artist normalization

Session note for bulk metadata repair and folder convergence.

## Rule
When multiple artist spellings refer to one real artist, normalize them to a single canonical display name before writing tags or deciding folder placement.

Example from this session:
- Canonical display name: `Godspeed You! Black Emperor`
- Collapsed variants included punctuation/no-punctuation spellings such as `godspeedyoublackemperor`, `Godspeed You Black Emperor!`, and `Godspeed You! Black Emperor`

## Practical pattern
- Normalize artist strings by stripping non-alphanumerics for lookup.
- Apply the canonical mapping in two places:
  - when choosing the dominant artist for a directory or album batch
  - when comparing existing tags before deciding whether to rewrite them
- If the normalized value differs from the current tag, treat it as drift and rewrite the tag so the library converges.

## Why this matters
- Plex can surface the same artist multiple times when tags disagree on punctuation or spacing.
- Folder names and tags need to converge on the same canonical form or future refreshes keep re-splitting the library.

## Implementation note
If the normalizer is generated inside an outer f-string, escape literal braces in embedded dicts with `{{ ... }}` so the generator does not try to interpret the mapping as formatting syntax.
