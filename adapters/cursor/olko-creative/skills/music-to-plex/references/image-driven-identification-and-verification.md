# Image-driven album identification and verification

Use this when the user gives an attached cover image, a misspelled album title, or only partial artist/release text.

## Pattern
1. Treat the image as primary evidence for identifying the release.
2. Use text search only to confirm the likely album, not to override the cover art.
3. After download/import, verify both:
   - the final NAS folder exists and contains audio files
   - Plex can see the album/track(s) after refresh
4. If the album title is uncertain, report the exact release name you actually matched, not the user's misspelling.

## Session example
- User wrote: "Paul McCrtney (newsest one)" and attached album art.
- The matched release was `Paul McCartney - The Boys of Dungeon Lane`.
- Verification succeeded only after checking the final folder and confirming Plex search results returned the album and tracks.

## Why this matters
Text-only guesses are fragile on new releases and misspellings. Cover art plus post-import verification avoids adding the wrong release or reporting success before Plex has indexed it.