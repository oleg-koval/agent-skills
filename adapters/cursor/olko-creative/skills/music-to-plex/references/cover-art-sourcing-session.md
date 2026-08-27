# Cover art sourcing session note

Use this when the user wants music notes plus actual album art, not just text notes.

## Pattern that worked
- Create the release note as usual, but do not stop there.
- Find a reliable source image for the release cover.
- Prefer an image URL already exposed by the page's image inventory over scraping HTML manually.
- If Bandcamp page image is available, use that for direct art.
- If Bandcamp does not expose the needed cover clearly, fall back to a verified artwork image from Wikipedia or another canonical release page.
- Save the image locally as `cover.jpg` in the artist or release folder.
- Verify with a filesystem search, not by assuming the download worked.

## Session outcome
- Fred Everything - Mercyless: cover saved as `cover.jpg` in the artist folder.
- Ron Trent - Altered States: cover saved as `cover.jpg`.
- Chez Damier & Ron Trent, M.D. - Hip To Be Disillusioned Vol. 1: cover saved as `cover.jpg`.
- St Germain - Tourist: cover saved as `cover.jpg`.
- Larry Heard - Can You Feel It: cover saved as `cover.jpg`.

## Pitfall
- Do not answer with notes-only completion if the user asked for album art. That is partial work.
- Treat art placement as part of the deliverable for music-library curation.