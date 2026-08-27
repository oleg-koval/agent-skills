# YouTube download fallback for music-to-plex

When a track rip fails with `HTTP Error 403: Forbidden` or `unable to download video data`, retry `yt-dlp` with a different YouTube client before abandoning the source.

## Proven retry order

1. Standard extraction.
2. Retry the same verified URL with `--extractor-args 'youtube:player_client=android'`.
3. If it still fails, use the next **already verified** candidate from the album source manifest (same canonical title and duration). Do not restart or discard the successfully staged tracks.
4. If no verified alternative remains, leave only that track unresolved and report the exact gap; do not fill it with an unverified remix, live take, or unrelated upload.

## Practical notes

- The Android client can surface working media URLs when the default client gets blocked.
- This is a retry pattern, not a guarantee. If it still 403s, stop burning time on the same URL.
- Keep the exact album folder and cover placement workflow separate from track acquisition. Cover art can usually be finalized even when the rip path is blocked.
- When the final import succeeds, remember to verify the NAS folder permissions too. A `700` directory owned by root can make Plex ignore the album even though the files download cleanly.
