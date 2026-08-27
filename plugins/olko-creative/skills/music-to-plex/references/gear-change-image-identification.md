# Cover-art driven identification and verification

Use this pattern when the user sends an image instead of a clean text release name.

## What worked in this session

- The image was a viewer screenshot, not just artwork.
- Vision identified the release from cover text: `74 Miles Away - Gear Change`.
- The tracker exact search did not return a hit for the release title.
- `yt-dlp` search found the exact YouTube upload:
  - `https://www.youtube.com/watch?v=KDwMTXynA4w`
  - title: `74 Miles Away - Gear Change // Single`
- The shorter official clip also existed, but the longer `// Single` upload was the better audio source.

## Verification sequence

1. Use the image as primary evidence for the release name.
2. Try tracker search on artist and title.
3. If tracker search returns nothing, search YouTube exact title.
4. Prefer the cleanest full upload over a short clip when both exist.
5. Download audio, tag it, write cover art, copy to NAS, then refresh Plex.
6. Verify in Plex with the music section search endpoint, not the generic search endpoint.

## Plex check that succeeded

- Section search endpoint:
  - `GET /library/sections/2/search?type=10&query=Gear%20Change`
- The returned track proved the import landed in Plex:
  - track title: `Gear Change`
  - artist: `74 Miles Away`
  - file path: `/volume1/music/library/74 Miles Away/2013 - Gear Change - Single/01 Gear Change.flac`

## Why this matters

Image-driven requests are easy to misread if you trust OCR or the user's prose too early. The right flow is image first, tracker second, YouTube fallback third, Plex verification last.