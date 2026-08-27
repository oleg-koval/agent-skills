# Bandcamp album identification when OCR/YouTube points at a single

Use this when cover art or a clip title points to a song, but the user actually wants the full release.

## Pattern from this session

- Cover art text said `74 Miles Away - Gear Change`.
- A YouTube clip title looked like a single: `74 Miles Away - Gear Change // Single`.
- The Bandcamp release page was the source of truth:
  - `https://74milesaway.bandcamp.com/album/gear-change`
  - page title: `Gear Change | 74 Miles Away`
  - tracklist: 8 tracks
  - release date: `2013-05-16`
- `yt-dlp -J` on the Bandcamp album URL exposed the album metadata directly:
  - `playlist_title = Gear Change`
  - `playlist_count = 8`
  - `album = Gear Change`
  - `album_artist = 74 Miles Away`

## Practical rule

If the clip title includes `Single`, `Official clip`, or another video-oriented label, do not treat it as the final release name. Check the Bandcamp album page (or equivalent store page) for the actual album title and track count before importing.

## Verification

- Prefer the album page over a clip title.
- Use `yt-dlp -J <album-url>` to confirm the release title and track list.
- Import the full album folder, not the clip single, before refreshing Plex.
- Verify the album in Plex by searching the music section for the album title after refresh.
