# Session note: Synology probe and mtp-bot mismatch

When `mtp-bot handle "add <album>"` reported `No route to host` against `192.168.178.245:5000`, direct network probes showed the NAS was reachable and the Synology API responded.

Observed checks:
- `curl http://192.168.178.245:5000/webapi/query.cgi?...` returned `{"success":true}` for `SYNO.API.Auth`.
- `/usr/bin/python3` socket connect to `192.168.178.245:5000` and `:5001` succeeded.
- `curl --cookie ~/.config/music-to-plex/cookies.txt https://rutracker.org/forum/dl.php?t=3296838` downloaded the torrent.
- Direct Synology API calls with `curl` succeeded and `task.cgi?method=create` returned `{"success":true}`.
- The created task showed up in Download Station as `dbid_806` with status `downloading`.

Takeaway:
- If the bot path fails but direct curl/API probes succeed, treat it as a bot runtime/context issue and verify the Synology call sequence with curl before changing album selection or torrent handling.