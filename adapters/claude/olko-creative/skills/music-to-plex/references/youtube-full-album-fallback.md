# YouTube full-album fallback salvage

Use this when RuTracker / Download Station fails and the only practical source is a YouTube full-album upload.

## Pattern observed

- `yt-dlp` can pull a clean album source, but uploader metadata is often garbage.
- Treat the first download as a source artifact, not Plex-ready media.
- Validate tags with `ffprobe` or `mutagen` before any organize step.

## Repair flow

1. Download the upload at highest audio quality.
2. Inspect embedded metadata immediately.
3. If the output is one long FLAC, split it into tracks using album track timings.
4. Retag each track with canonical artist, album, year, tracknumber, and tracktotal.
5. Embed official cover art, not the YouTube thumbnail.
6. Move the repaired album into the final NAS music path.
7. Refresh Plex only after the final path exists.
8. Verify the album appears in Plex search.

## NAS transfer workaround

When `rsync` or `scp` fights remote path quoting, use a tar pipe instead:

```bash
cd /local/staging && tar -cf - *.flac | ssh user@nas 'cd "/volume1/music/.../Release" && tar -xf -'
```

If macOS leaves AppleDouble sidecar files on the NAS, remove `._*` before refresh.

## Session note

For `Ozzy Osbourne - Diary Of A Madman (1981)`, the fallback source was a YouTube full-album upload. The tracks were downloaded to FLAC, retagged, cover art embedded, copied into `/volume1/music/metal/Ozzy Osbourne/Diary Of A Madman (1981)`, AppleDouble files removed, and Plex refreshed with `mtp refresh --path`.
