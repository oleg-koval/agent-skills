# Embedded cover-art repair session notes

Use this when a DJ crate or playlist already exists on the NAS and Plexamp shows the gray "no album art" thumbnail on every track.

## What worked

- The set was `Deep Lineage Set` and the source folder was:
  `/volume1/video/plex-imports/deep-lineage-set`
- The tracklist came from a screenshot, so the first pass was image-assisted identification of the set name and sequence.
- The fixed files were FLACs, so `mutagen.flac.FLAC` was enough to rewrite embedded artwork in place.
- Each file ended up with exactly one embedded picture after the rewrite.
- Plex was refreshed with `GET /library/sections/{id}/refresh` on the NAS, not a UI click.

## Practical pattern

1. Identify the exact release for each track before writing tags.
2. Pull the release art from Cover Art Archive or another authoritative source.
3. Rewrite embedded art in the track files themselves.
4. Verify the resulting files have `1` picture each.
5. Refresh Plex only after the files are in final NAS path.

## Pitfalls

- Folder-level artwork is not enough if the tracks themselves have missing embedded art and Plexamp is reading track thumbnails.
- Do not assume the Spotify-looking playlist title is the actual release title. Screenshot tracklists often mix track names, artists, and playlist labels.
- When a release has similarly named variants, resolve by artist + release group, not title alone.

## Verification

Check both:
- file-level art count in each FLAC/MP3
- Plex refresh on the target section

If both are true, the playlist should render with original cover art in Plexamp.
