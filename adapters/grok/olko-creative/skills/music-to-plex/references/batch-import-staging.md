# Batch import staging and source validation

Use this pattern when importing multiple albums from downloaded source material into Plex.

## Stage-first workflow

1. Stage each album in a temp tree before touching the NAS library path.
2. After staging, push the staged tree into the final NAS location in one shot.
3. Normalize final permissions before refresh:
   - album directories: `755`
   - audio files and art: `644`
4. Refresh Plex only after the final path and permissions are correct.
5. Verify Plex search for album and at least one track after refresh.

## Source validation for YouTube rips

- Prefer a source with reliable chapter metadata when the album is chapter-based.
- If the first candidate download produces a bad last track or an invalid MP3, do not keep tagging it. Treat that as a source problem and try an alternate full-album upload instead.
- Sanity-check extracted audio before tagging or moving it into the library. A quick `ffprobe` or `file` pass on each MP3 is enough to catch a corrupt final track.

## Practical fallback

If the local machine cannot write to the NAS library path directly, keep the staging tree local and stream it to the NAS over SSH, then run the permission normalization and Plex refresh remotely.
