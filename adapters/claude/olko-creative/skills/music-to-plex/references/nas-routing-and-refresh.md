# NAS routing and Plex refresh

Session takeaway:
- For albums that must land in a genre bucket, the final Plex path matters more than the download origin.
- If the intended genre bucket does not exist or cannot be written by the organizer, create a writable bucket first and move the album there instead of leaving it in `unsorted`.
- After moving files into the final NAS music folder, trigger a Plex music library refresh for the correct section.
- If tags are corrected after the move, refresh again. Plex refresh does not retroactively fix a wrong folder placement; it only re-indexes what is already on disk.

Case study from this session:
- Iron Maiden albums ended up in `/volume1/music/metal/Iron Maiden/...` after the metal bucket was made writable.
- A later metadata correction from `Pop` to `Heavy Metal` required another Plex refresh.

Reusable order of operations:
1. Confirm the album's real tags.
2. Ensure the target NAS bucket exists and is writable.
3. Move the album into the final Plex-rooted path.
4. Refresh Plex section 2.
5. Verify PlexAmp can actually see the album after the refresh. If it cannot, re-check the on-disk path before assuming the scan succeeded.
6. If tags changed, refresh Plex again.

Session note:
- In one follow-up, Plex was refreshed successfully but PlexAmp still showed nothing. The fix path was to re-verify the album's final library location instead of trusting the refresh alone.
