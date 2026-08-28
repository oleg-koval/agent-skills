# Album fallback when `mtp-bot` has no release result

Use this only after the album handler returns an actual no-result outcome and the user has explicitly asked to continue the import. A bot/provider parsing or source-search failure is not a reason to end the job with a status report.

## Fail-closed, track-by-track fallback

1. Resolve an original official release in MusicBrainz. Record its release ID, release year, ordered tracks, and canonical durations.
2. Prefer separate source audio per track over a single full-album upload. This produces real track boundaries and avoids cumulative timing drift when an upload has missing/extra intro or outro seconds.
3. For each track, query using artist + track title + album. Accept a source only if:
   - normalized source title contains the canonical track title;
   - duration is plausibly close to the canonical duration;
   - it is not visibly a video, remix, live take, or edit unless that is the canonical track.
   Search normalization is only a first pass: canonical punctuation and wording often differ (`Parts` vs `Pts`, curly apostrophes, or ellipses). For a missed title, manually compare candidate title and MusicBrainz duration, record the chosen URL as an explicit override in the source manifest, then resume only the missing track, never relax the filter globally.
4. Resolve the canonical genre from MusicBrainz (or another authoritative release source) before final tagging. Convert, then tag every output with artist, album artist, album, title, release year, **genre**, track number/total, and MusicBrainz release ID. Embed a verified front-cover image in every FLAC. Use that same genre value to build the final Plex library path, so the tag and `Genre/Artist/Album (Year)` folder agree.
5. Verify the output file opens, has the required tags and embedded art, and is in the final artist/album folder structure before transfer.
6. Transfer to the NAS Plex root only when the NAS is reachable. Then refresh Plex, inspect the album/track count in Plex/Plexamp, and only then report completion.

## Full-album uploads

Only use a continuous full-album upload if individual tracks are unavailable. Split against a canonical cue/timing sheet, inspect boundaries with silence detection and waveform/listening checks, and do not rely on proportional timestamps alone. A duration mismatch between the upload and the canonical release is a red flag for a different master, gap structure, or intro/outro.

## Communication rule

Do not stop at “the source returned zero results” when the user has asked for the music. State the fallback being launched, make real progress, and distinguish:

- **staged locally** from
- **transferred to NAS** from
- **verified visible in Plex/Plexamp**.
