# Zero-track playlist recovery

Use this when Plex shows a playlist shell but the track list is empty or `0 tracks`.

## What it means

- The playlist object exists.
- The import likely failed to attach playable items, or the items have not been indexed yet.
- Do not treat the playlist as done until Plex returns leaf items.

## Recovery order

1. Read back the playlist with `GET /playlists/<id>/items`.
2. Confirm the returned leaf count matches the source track count.
3. Compare the returned order with the intended playlist order.
4. If the playlist is still empty, re-check the source track `ratingKey` list before trying another create.
5. If the UI says `0 tracks` but the API returns items, trust the API and let PlexAmp refresh.

## Rule

A playlist is only imported when the API read-back shows the expected number of items and order. The UI tile alone is not proof.