# Torrent Stall & YouTube Fallback Pattern

**Context:** May 2026 session adding "Dexter Gordon - Go" to Plex revealed a reliability pattern in RuTracker sourcing.

## The Pattern

RuTracker torrent searches often succeed (find 5–10 versions), but the selected torrent may:
- Have low/stalled seeders
- Stall at 0% or low % for 5+ minutes
- Eventually timeout or fail silently

Rather than wait indefinitely, the workflow should detect stall within 5 minutes and pivot to YouTube + MP3.

## Dexter Gordon - Go (Case Study)

Search returned multiple FLAC versions:
- `[SACD-R][OF] Dexter Gordon – Go - 2010` (9 seeds, 1 GB)
- `[TR24][OF] Dexter Gordon - Go - 1962/2013` (8 seeds, 1 GB)
- `(Bop, Hard Bop) [CD] Dexter Gordon - Go! - 1962 (1989 Japan Edition), FLAC` (7 seeds, 254 MB) ← often a safe choice: smaller, older, established peers
- `[CD] Dexter Gordon - GO-RVG Edition - 1962 {1998 Blue Note RVG}` (5 seeds, 307 MB) ← audiophile remaster

**Watch for:** even 7–9 seeds may not mean fast peers. Seed count ≠ reachability.

## 5-Minute Timeout Rationale

- 30 seconds: too aggressive, may give up on legitimate slow starts
- 5 minutes: Oleg's preference, balancing hope vs. pragmatism
- 10+ minutes: frustrating UX; YouTube is known-good

## YouTube Fallback Quality

When switching to YouTube, the skill currently:
1. Fetches full album via `yt-dlp`
2. Extracts audio to `.opus` or `.mp3`
3. Rewrites ID3 tags (artist, album, genre)
4. Moves to NAS via SSH
5. Refreshes Plex

Result: playable album in Plexamp. Quality is typically 128–320 kbps MP3 (YT limits). Not lossless, but reliable and fast.

## Detection & Automation (current behavior, June 2026)

This is now **automated and interactive**. The background notifier
(`mtp-notify`) polls `mtp status <task_id>` every 30s. If percent-done stays
flat for the stuck window (default 10 min; `stuck_timeout` in the chat-state
blob), it flips the chat to the `STUCK` state and posts a message with **four
numbered options**, and it does NOT auto-pivot to YouTube:

```
1️⃣ Wait 1 more hour
2️⃣ Wait N hours (asks how many)
3️⃣ Try the next release in the list   ← deletes stuck task, auto-picks next by seeds
4️⃣ Grab it from YouTube in highest quality
```

The user's reply (`1`–`4`, a count of hours, or "next"/"youtube") is passed
verbatim to `mtp-bot handle`, which routes it through the `STUCK` /
`STUCK_WAIT_INPUT` handlers in `mtp/bot/machine.py`. Option 4 returns the
`__YOUTUBE_FALLBACK__` signal that hands the YouTube acquisition to Hermes.

Operator choice is preserved by design: the user decides per-stall, rather than
the tool silently switching sources.
