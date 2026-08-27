# YouTube-first playlist import for MTP

Use this flow when the user gives a YouTube playlist URL or a plain track list and wants it landed in Plex.

## Input shapes
- Playlist URL
- Plain list of `Artist - Title` lines

If only a track list is provided, resolve each track on YouTube first, then download in album/sequence order.

## Download + staging
Use max-quality audio extraction and preserve ordering with explicit numbering:

```bash
yt-dlp -x --audio-format flac --audio-quality 0 \
  --write-thumbnail --convert-thumbnails jpg --embed-thumbnail \
  --add-metadata \
  -o "/tmp/mtp_youtube_crates/<crate>/work/raw/%(playlist_index)02d - %(title)s.%(ext)s" \
  "<youtube-url>"
```

Notes:
- Keep a manifest with index, source URL, resolved artist/title, and final filename.
- For VA / DJ-style sets, keep track order stable even if metadata is messy.
- If a title needs cleanup, fix it in tags, not by renaming out of sequence.

## Import into Plex
- Copy the finalized files into the NAS import path that Plex scans for the music section.
- Trigger a library scan after the copy.
- Create a normal Plex playlist from the imported track rating keys in the exact source order.

## Verification
Prefer proof over assumptions:
- Check Plex scanner logs for `Added new metadata item` / `Loaded metadata for ...` on each track.
- Confirm the imported track by querying Plex search directly and inspecting the returned `ratingKey`, `title`, `originalTitle`, and `parentTitle`.
- For playlist verification, read the playlist back and enumerate items in order.

## Plex metadata quirks
- For compilation-style sets, Plex often shows `grandparentTitle=Various Artists`.
- The displayed `title` may be the track title, while `originalTitle` carries the artist.
- Search by both artist and title when matching imported tracks.
- If a search query misses a track, try the cleaned title and artist separately.

## Session-proven pattern
The Deep Lineage Set import worked by:
1. staging 8 FLAC tracks from YouTube,
2. copying the final files into a Plex-scanned NAS import directory,
3. refreshing Plex,
4. creating a playlist in the source order,
5. verifying all 8 items and their order.
