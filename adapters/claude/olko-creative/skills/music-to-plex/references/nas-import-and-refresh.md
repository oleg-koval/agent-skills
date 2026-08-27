# NAS import and Plex refresh note

Use this workflow when importing an album into the NAS music library and refreshing Plex afterwards.

## What worked in this session
- Source can be a chaptered YouTube/vinyl rip when it contains a clean track breakdown.
- Inspect chapters first to confirm track count and titles before tagging.
- Stage files locally, tag them, then transfer to the NAS over SSH if direct writes to the library path are blocked by permissions.
- If the final library path is root-owned, use an interactive SSH `sudo` move on the NAS rather than trying to bypass permissions from the local machine.
- Expected destination pattern:
  - `/volume1/music/library/<genre>/<Artist>/<Album (Year)>`
- After the move, refresh the Plex music section so the new album is indexed.
- Verify the remote album folder contains the expected track count before closing out.

## Output preference
- Keep user-facing confirmation short. Do not dump command output unless the user asks for it.