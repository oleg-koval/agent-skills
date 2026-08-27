# Malformed FLAC fallback notes

Session takeaways for bulk music library tag repair:

- `ffmpeg` can fail on some legacy FLACs with `sample rate not set` or `invalid FLAC header`.
- Treat these as file-level salvage failures, not library-wide failures.
- Prefer `mutagen` for tag writes first. Only fall back to `ffmpeg` when a file is structurally writable.
- If a FLAC header is invalid, record the path, skip it, and continue the batch. Do not retry indefinitely.
- After successful writes, refresh Plex only once the files are in their final NAS path.

This is a session note, not a general claim about all FLAC files.