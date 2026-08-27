# Plex playlist append and verification

Use this when a playlist already exists and needs more items added.

## What worked in this session

- Read the playlist shell first: `GET /playlists/{playlist_id}`.
- Read the current contents back with: `GET /playlists/{playlist_id}/items`.
- Append library tracks with: `PUT /playlists/{playlist_id}/items?uri=server://{machineIdentifier}/com.plexapp.plugins.library/library/metadata/{ratingKey}`.
- For multiple tracks, repeat the `uri` param once per item in the same request or loop one-by-one when order matters.
- Verify by reading back `leafCount` and the returned `Metadata` item list.

## Pitfalls

- A successful PUT response is not enough. Always confirm the playlist item list changed.
- If Plex returns a shell with `leafCount: 0`, do not assume creation failed. It may just need item appends.
- Use the Plex server's `machineIdentifier` from `/identity` when building `server://...` URIs for library items.
- If a requested track does not move the count, the add may have been a duplicate or the URI may be wrong. Re-read the item list before retrying.
