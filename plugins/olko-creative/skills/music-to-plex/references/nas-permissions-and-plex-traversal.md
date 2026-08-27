# NAS permission repair and Plex traversal

Use when a staged album cannot be copied into the canonical Plex music library, or Plex is not indexing files after a successful copy.

## Scope the repair narrowly

- Do **not** recursively `chown` the broad `/volume1/music` share just to enable one import.
- If the owner explicitly wants durable managed imports, grant ownership/write access at the configured Plex **library root** (for this environment, `/volume1/music/library`) only.
- Verify it with a real SSH probe: create a unique temporary directory, write a file inside it, remove both, then inspect ownership/mode.

## Permissions to verify

1. Managed import account can create an artist directory below the library root.
2. Every parent from the Plex section root through `Artist/Album` is traversable by the Plex process. Use `755` for artist and album directories unless the Plex service group has been deliberately granted equivalent execute access.
3. Do not infer traversal from file readability. A `770` artist directory can prevent scanning even though the account that transferred the FLACs can read the album.

## Transfer fallback

If the NAS rsync implementation cannot support the desired safe flags or preservation semantics, stream the already-validated album using `tar` over SSH into the final directory. On macOS-originated sources, remove `._*` AppleDouble sidecars afterward and verify the exact FLAC count on NAS before triggering Plex refresh.

## Plex evidence order

1. Refresh the music section after permissions and copy are final.
2. Query the Plex DB for `media_parts` at the final path.
3. Read album metadata and track children through Plex API/DB; do not rely only on a fuzzy library-search query.
4. Compare the returned track count and sequence with the canonical release tracklist.
