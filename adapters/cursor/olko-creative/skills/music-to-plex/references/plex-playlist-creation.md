# Plex playlist creation from existing library tracks

Session finding:
- The Plex server accepted playlist creation through the standard library API, not through the app UI.
- Tracks can be resolved by section search using `type=10`, `title`, and `artist`, then referenced by `ratingKey`.
- Playlist creation used a `server://<machineIdentifier>/com.plexapp.plugins.library/library/metadata/<comma-separated ratingKeys>` URI.

Working sequence:
1. Read `/identity` with the Plex token to get `machineIdentifier`.
2. Search the music section for each track and capture the track `ratingKey`.
3. POST to `/playlists` with:
   - `title=<playlist name>`
   - `type=audio`
   - `smart=0`
   - `uri=server://<machineIdentifier>/com.plexapp.plugins.library/library/metadata/<ratingKey1>,<ratingKey2>,...`
4. Verify by GETting `/playlists/<id>/items` and checking leaf count / order.

Pitfalls:
- Track search can 400 if you use the wrong query shape. `type=10&title=...&artist=...` worked here.
- Do not assume `search?query=` works for music tracks.
- Verify the playlist contents after create, not just the create response.
