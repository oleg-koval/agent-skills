# Plex token source

Session note:
- Secrets (`PLEX_TOKEN`, `SYNO_USER/PASS`, `RUTRACKER_USER/PASS`, `TELEGRAM_BOT_TOKEN`)
  live in `~/.config/music-to-plex/.env`, NOT in `config.toml`. `config.toml` holds
  only non-secret structure (URLs, `music_section_id`, paths).
- `Config.load()` sources that `.env` automatically (via `load_env()`), so every
  entrypoint — `mtp`, `mtp-bot`, `mtp doctor` — sees the token without the shell
  having to `export` anything. If a check says "PLEX_TOKEN not set", the fix is the
  `.env` file, not the shell env and not `config.toml`.
- Verify quickly with: `mtp doctor` (look for "PLEX_TOKEN set" and
  "Plex reachable + token valid").
- Do not echo the token in chat or logs; use it only for local verification.

If the token is missing from `.env`, fetch it from the NAS Preferences.xml:

    ssh beheerder@192.168.178.245 'grep -oE "PlexOnlineToken=\"[^\"]+" \
      "/volume1/PlexMediaServer/AppData/Plex Media Server/Preferences.xml"'

then add `PLEX_TOKEN=<value>` to `~/.config/music-to-plex/.env`.
