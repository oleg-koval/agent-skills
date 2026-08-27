# Duplicate torrent handling

Session note:
- The same magnet (`41bfeae4e4edb72b0e4acc1f816cf4c4914965f2`) was submitted repeatedly for The Chemical Brothers - *Push the Button*.
- Synology Download Station replied with `Duplicate torrent file`.
- Three task IDs showed the same failed magnet in `list_tasks`: `dbid_807`, `dbid_808`, `dbid_809`.

Retry-safe sequence:
1. Call `list_tasks` first.
2. Search by magnet hash / title.
3. If the task already exists, do not add another copy.
4. If the task is failed and duplicated, clean the stale entries before trying a fresh add.
5. Re-run search with plain artist/album text only. Do not expose magnet URLs back to the user.

Session outcome:
- After cleanup, the only RuTracker hit for this album was topic `3296838`.
- There was no alternate source in the current index, so the retry used the same text-only release rather than inventing a fallback.

This is a Download Station state issue, not a Plex ingest issue.
