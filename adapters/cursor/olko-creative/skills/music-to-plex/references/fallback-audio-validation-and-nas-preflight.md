# Manual album fallback: validation and NAS preflight

Use this only after the normal `mtp-bot` path has returned a real no-result/fallback outcome, or the user explicitly authorizes a manual recovery path.

## 1. Derive the request and route correctly

- A bare `mtp` accompanying cover art is an album request. Read the cover, then confirm the canonical artist, release title, year, official track count, and expected track durations before acquiring anything.
- `mtp-bot handle` must receive the **originating Telegram chat ID**. For a group, that is the negative group ID from the inbound route, not the user ID and not the configured home-DM ID.
- Do not call `mtp-bot` with a naked image caption such as `mtp`; it has no album text to parse. After identification, use a clear album-shaped add request only if the workflow permits a resolved-image continuation.

## 2. Preflight NAS while metadata is being confirmed

Read-only inspect the exact final parent path first. Verify:

```bash
ssh <user>@<nas> "test -d '<final-parent>' && test -w '<final-parent>' && test -x '<final-parent>'"
```

If the artist directory does not exist, verify the transfer account can create it **before** downloading the whole album. A read-only library is a blocker, not a signal to choose an arbitrary alternate directory. Ask the NAS owner for an album-scoped directory plus write/traverse access.

## 3. Track-by-track YouTube staging

For every canonical track:

1. Search separately; prefer an official audio upload.
2. Reject live, remix, edit, video, and compilation variants unless the canonical release requires one.
3. Check normalized title and source duration against the canonical duration before download.
4. Tag *every* FLAC and embed the same verified cover art. Never skip tagging merely because a filename already exists: the process may have timed out between conversion and tagging.

## 4. Decode and duration validation are mandatory

A successfully created `.flac` may still be truncated after a timeout/interruption. Before NAS transfer:

- decode every FLAC to null with FFmpeg (or use another installed lossless decoder);
- check exact file count, canonical tags, track numbering, and an embedded front-cover picture;
- compare each decoded duration with MusicBrainz/canonical duration using a tolerance appropriate to the source (normally ±12%; use a tighter bound when directly matching an official upload).

If any duration is implausibly short, replace that track from a verified source, re-tag it, and repeat the full per-track check. Do **not** transfer or refresh Plex until all tracks pass.

## 5. Resume safely after interruption

Treat a process timeout as an incomplete transaction. Enumerate staged FLACs and validate their tags/art/durations, rather than treating `EXISTS` as success. Re-run idempotent tagging over the complete track set, then validate again.
