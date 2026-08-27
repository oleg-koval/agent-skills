# Cover art and PlexAmp visibility

Session note: when a music release is imported from a chapter-split source or a plain audio rip, the album may index in Plex with no artwork because there is no local cover image and Plex cannot reliably match the release online.

## Practical rule

If PlexAmp shows the album but the tile is blank or generic:
1. Check the final album folder for a local image first (`cover.jpg`, `folder.jpg`, `front.jpg`, or `*.png`).
2. If none exists, fetch the real release art from Discogs or another authoritative release listing and place it in the album folder as `cover.jpg`.
3. Prefer the exact release art over YouTube thumbnails, generic web images, or a random match.
4. Refresh the Plex music section again after the art file is in place.
5. Prefer folder art for compilation releases and niche albums that Plex metadata matching may not recognize.

## Useful note

A clean import can still be missing art. That is not the same failure as library ingest. Treat artwork as a separate visibility layer from track indexing.

## Discogs workflow

- Search Discogs by the exact album title and year.
- Open the release page or API record, then use the release image for the final folder art.
- Verify the art file on disk after copy, then refresh Plex and re-check PlexAmp.
