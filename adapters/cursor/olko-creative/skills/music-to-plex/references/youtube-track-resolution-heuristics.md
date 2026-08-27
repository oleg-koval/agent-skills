# YouTube track resolution heuristics

Use this when a user gives a plain `Artist - Title` list and wants it turned into a Plex playlist.

## Search pattern
- Run `yt-dlp --flat-playlist --dump-json "ytsearch5:<artist> <title>"` for each line.
- Keep the source order from the user list. Never reorder by search result rank.

## Scoring
Prefer results with:
1. exact title match,
2. artist match in the channel/uploader name,
3. `Topic` channel or official upload,
4. clean metadata over remix/edit clutter.

## Pitfalls
- The first search hit is often wrong for house/disco catalog cuts.
- If the user only gives a vibe list and not a playlist name, derive a short title from the theme, then ask once before creating the Plex playlist.
- For compilation-style uploads, check both title and channel before deciding.

## Verification
- After download, confirm each track title still maps to the intended line.
- When building the Plex playlist, read it back and verify item order matches the source list.
