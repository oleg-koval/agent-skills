# YouTube-only lineage playlist fallback

Use when the user wants a new DJ crate or playlist based on mood/lineage rather than a formal release request, and the intended path is YouTube track finding/downloading only.

## Trigger

- The user says things like "check this message and create new playlist" and provides lane/feeling language instead of a single album.
- The brief is built from references, influences, or lineage tags such as "classic deep house DNA", "modern disco/deep house revival", "jazzy/warm cuts", or a left-field closer.
- The task is explicitly on the YouTube branch, not a tracker or store purchase flow.

## Pattern

1. Convert the message into a small set of lanes first.
2. Pick 1-3 anchor artists or canonical tracks per lane.
3. Search exact titles with `yt-dlp`/YouTube query strings before broadening the search.
4. Prefer official or Topic uploads, then the cleanest stable upload with the closest duration and metadata match.
5. Assemble a local crate manifest, tracklist, and playlist file.
6. Verify the files exist and the playlist content matches the intended lane order.

## Curation notes

- Keep the middle of the set mix-friendly.
- Use the final lane for the emotional curveball or taste-flex closer.
- If the user explicitly says the branch is YouTube-only, do not route through tracker/search paths for acquisition.
- If Spotify or another catalog route is unavailable, skip it and continue with the YouTube branch instead of stalling.

## File outputs

- `00_MANIFEST.json`
- `00_TRACKLIST.md`
- `00_PLAYLIST.m3u8`

This reference is session-derived but the pattern is reusable for future YouTube-only crate builds.