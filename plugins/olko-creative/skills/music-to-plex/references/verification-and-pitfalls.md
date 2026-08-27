# Verification and pitfalls

Session takeaway:
- The bot can print a successful download-start message even if the follow-up notification step fails.
- In this case, the started download later showed a local album folder at `/Volumes/home/downloads/Fear Of The Dark` containing the FLAC tracks.
- `mtp-notify` originally failed with `album required` because the bot passed `task_id` + `chat_id` and the notifier expected full metadata. The durable fix was to resolve `artist` and `album` from `~/.config/music-to-plex/bot-state.db` when they are omitted.
- The downloaded FLAC also had a bad `genre` tag (`Pop`), which can misroute the album during organize. Verify tags before moving anything into the Plex library.

Verification pattern:
1. Treat the bot's "Downloading ..." output as a start signal, not proof of completion.
2. Check the configured mount download directory for the album folder.
3. Confirm actual audio files exist inside the folder before telling the user the album is ready.
4. If the notification helper errors, report that separately from download state.
5. If tags look wrong, fix or override them before organize, otherwise Plex refresh will not correct the folder placement.

Known local path from this session:
- `/Volumes/home/downloads/Fear Of The Dark`
