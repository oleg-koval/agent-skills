# DJ tracklist crate ingest to NAS + Plex

Use when the user posts a timestamped DJ set tracklist and wants it turned into a DJ-usable folder and Plex/Plexamp listening playlist.

## Scope and legality

- Prefer legal/owned sources: Bandcamp, Qobuz, Beatport, Juno Download, artist/label stores, existing NAS library, or user-provided files.
- YouTube is allowed only for lawful sources: official uploads, artist/label uploads, Creative Commons, public-domain material, or user-confirmed personal-use fallback where local law/account terms permit it.
- Do not present piracy as the default path. If a track is commercially available, prefer purchase/store source over a random YouTube rip.
- If source rights are unclear, stage it as `needs_source_confirmation` and ask before download.

## Input format

Accept lines like:

```text
00:00 Intro - Marc Bianco
02:30 Ghetto Opera (Loft Mix) - Nicholas featuring Nikki-O
1:19:17 Under The Sun - Fred Everything
```

Parse into:

- original timestamp
- title
- mix/version
- artist(s)
- original line
- confidence
- source URL(s)
- final file path
- metadata status
- Plex ratingKey if indexed

## Target folder structure

Create a dedicated crate separate from normal album folders so it is DJ-friendly and easy to copy to Rekordbox/USB later:

```text
<NAS_MUSIC_ROOT>/DJ Crates/<YYYY-MM-DD> - <Set Name>/
  00_PLAYLIST.m3u8
  00_TRACKLIST.md
  00_MANIFEST.json
  artwork/
    folder.jpg
    01 - Artist - Title.jpg
  audio/
    01 - Artist - Title (Version).flac
    02 - Artist - Title.mp3
```

Naming rules:

- Prefix files with set order: `01`, `02`, `03`.
- Use `Artist - Title (Mix)` after the prefix.
- Sanitize `/`, `:`, shell metacharacters, and weird whitespace.
- Preserve original timestamp in tags/comments and manifest, not in filename.
- Keep source quality in manifest. Do not put `[YouTube]` in the DJ filename unless quality/source ambiguity matters.

## Acquisition order

For each track:

1. Search existing NAS/Plex library first. Reuse existing clean file if present.
2. Search official stores/catalog pages for metadata confirmation.
3. Search YouTube only after metadata is clear or when no store source exists.
4. Prefer official artist/label uploads over user rips.
5. Download best audio only when lawful/approved.
6. If the track cannot be sourced confidently, create a manifest row with `status=missing` and continue.

## Tool routing pitfall

`mtp-bot handle` is for one album/release at a time. Do not feed it a DJ playlist, crate brief, or natural-language list of artists. It can correctly classify that as not an album request and skip it.

For crates, parse the tracklist yourself into a manifest, then run per-track acquisition and verification. If you use the plain `mtp` album search path for a release, inspect ranking before adding: the one-shot album auto-pick historically ranked by seeds, not by archival quality. When the user asks for "biggest quality" or "FLAC as possible", prefer this order explicitly: true lossless format (`FLAC`, `WAV`, `ALAC`, `APE`, `WavPack`, `TTA`), then larger release size when it matches the release, then seeds/availability. Never present a lossy YouTube-to-FLAC conversion as real lossless.

## YouTube search and download pattern

Use exact queries first:

```bash
yt-dlp "ytsearch5:<artist> <title> <mix/version>" --dump-json --flat-playlist
```

Pick using this priority:

1. exact artist + exact title + exact mix/version
2. official channel / label channel
3. duration close to expected release duration, not the DJ-set timestamp segment
4. audio quality / stable upload
5. avoid live rips, radio rips, sped-up/slowed/reverb, AI covers, compilations, and low-effort reposts

Download pattern:

```bash
yt-dlp -x --audio-format flac --audio-quality 0 \
  --embed-thumbnail --convert-thumbnails jpg \
  --add-metadata \
  -o "staging/%(title).200B.%(ext)s" "<url>"
```

If FLAC conversion is wasteful because source is lossy, keep high-quality MP3/M4A and record `source_lossy=true` in manifest. Do not pretend a YouTube FLAC is lossless.

## Metadata repair

After every download, rewrite tags from the parsed/canonical metadata, not from uploader title:

Required tags:

- title
- artist
- albumartist = `Various Artists`
- album = `<Set Name>`
- tracknumber / tracktotal
- date/year if known
- genre = best broad crate genre, e.g. `Deep House`, `Disco House`, `Balearic`
- comment = `Crate: <Set Name>; Original timestamp: <timestamp>; Source: <url>`
- compilation = 1 where supported

Recommended DJ tags if tools are available:

- BPM
- initial key / Camelot key
- replaygain / loudness normalization metadata

Use `mutagen` for tag writes. Use `ffmpeg` only for conversion/extraction. Validate tags with `ffprobe` or `mutagen` before moving to NAS.

## Cover art

Cover hierarchy:

1. official release cover from MusicBrainz/Discogs/Bandcamp/store page
2. label/artist upload thumbnail if official
3. YouTube thumbnail only as fallback
4. crate-level generated or neutral cover if no per-track cover exists

Save:

- embedded art in each audio file when format supports it
- `artwork/<track>.jpg`
- `folder.jpg` for the crate

## Plex integration

After final files are copied to the NAS path:

1. Fix permissions so Plex can traverse directories.
2. Refresh the relevant Plex music section.
3. Search Plex for every imported track and capture ratingKeys.
4. Create a Plex audio playlist named `<Set Name> - DJ crate` using ratingKeys in set order.
5. Verify playlist item count and order by reading back `/playlists/<id>/items`.
6. Report missing/unmatched tracks separately. Do not call the crate done if Plex indexed only part of it.

Use `references/plex-playlist-creation.md` for the exact Plex API sequence.

## Outputs to user

Return concise status:

- crate folder path
- Plex playlist name / ID
- total tracks requested
- imported count
- Plex-visible count
- missing/problem tracks
- source quality warning if any tracks came from lossy YouTube audio

Example:

```text
Crate built: /volume1/music/DJ Crates/2026-07-04 - Deep House Set/audio
Plex playlist: Deep House Set - DJ crate, 27 tracks
Imported: 25/27
Plex visible: 25/25
Missing: 2 - exact source not found
Warning: 8 tracks came from YouTube lossy sources; fine for listening/practice, not archival.
```

## Verification rules

- A downloaded file is not enough. Verify tags, path, Plex visibility, and playlist order.
- A Plex refresh response is not enough. Read back playlist items.
- Do not overwrite existing clean library files. Copy/link them into the crate or reference them in M3U.
- Keep the manifest. It is the audit trail for where each track came from and why a track is missing.
