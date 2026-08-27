# Per-track album-art split

Use this when a DJ crate or batch import shows the same cover for every track, but each track actually belongs to a different release.

## Pattern
- If tracks are from different albums, do not try to force one shared album folder.
- Split files into one folder per release before Plex refresh.
- Keep embedded art on each file, but make the folder path match the release so Plex reads the right parent album.
- Refresh the Plex audio section only after the files are in their final per-album locations.

## Session note
In the Deep Lineage Set case, the tracks were moved from one staging folder into release-specific folders like `Washing Machine/`, `Altered States/`, and `Tourist/`, then Plex was refreshed. That was the right fix for the "same art for every track" symptom.
