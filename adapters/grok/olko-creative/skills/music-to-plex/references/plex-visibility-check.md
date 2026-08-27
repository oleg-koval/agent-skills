# Plex visibility check when PlexAmp shows nothing

Use this when the album was supposedly imported, a refresh was triggered, but PlexAmp still returns no results.

## Check order

1. Verify the album is on the NAS in the final Plex-rooted music path, not a staging/download directory.
2. Verify the final folder name matches the canonical album/artist/year structure that Plex scans.
3. Refresh Plex *after* the files are in the final path.
4. Query Plex by track or album title and artist. If search size is 0, Plex has not indexed the content yet.
5. If the content exists on disk but Plex still sees 0 results, treat it as a path/layout problem first, not a rescan problem.

## Practical rule

A successful refresh is not proof of visibility. The only reliable proof is:
- audio files exist in the final library path, and
- Plex search returns matching tracks/albums.

Use Plex's own search endpoint with the album title and at least one track title. If the album appears but tracks do not, the folder landed but indexing is incomplete.

## Failure mode now covered

If Plex search stays at `size=0` after refresh and the scanner later crashes, treat the scanner crash as the root signal. Do not keep retagging or re-refreshing the album until the log or crash report explains why Plex never indexed it.

## Pitfalls from this session

- A root-owned `700` album folder blocked Plex traversal even though the files were present. Fix the directory to `755` before refresh so Plex can traverse it on first scan.
- An album folder existed on disk under the expected `Various Artists/...` tree, but Plex search still returned `size=0` for title and track queries until the final path was re-verified and refresh was repeated.
