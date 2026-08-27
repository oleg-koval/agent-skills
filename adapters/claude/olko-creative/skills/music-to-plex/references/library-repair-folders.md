# Library repair: folder consolidation and malformed FLAC handling

Use this when repairing an existing music library, not just ingesting one album.

## Pattern
- Normalize artist variants to a canonical display name before deciding folder placement.
- Apply the same canonical mapping while aggregating batch dominance and while comparing per-file tags.
- Treat punctuation-only splits as real drift if they create duplicate artist folders in Plex.
- Sanitize destination folder names before joining paths. `AC/DC` is display text, not a path separator.
- If a FLAC is malformed (`invalid FLAC header`, `sample rate not set`), skip it, record it, and keep the batch moving.
- Refresh Plex after files reach their final NAS paths, then refresh again after any later tag or folder rename.

## Session-specific pitfalls observed
- Safe folder naming must convert `/` to `-` before moving trees.
- Canonical artist normalization fixed GYBE variants by collapsing them to `Godspeed You! Black Emperor`.
- The repair pass surfaced two bad Twin Peaks FLACs that should be quarantined or skipped rather than retried as metadata issues.
- Raw error logs are noisy. Default to concise status unless the user explicitly asks for debug output.

## Verification
- Spot-check canonical artists that previously split: GYBE, AC/DC, i/dex.
- Verify one folder per canonical artist on disk.
- Refresh Plex and confirm the duplicate artist entries disappear after the next scan.
