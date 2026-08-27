# Manual fallback: NAS transfer and Plex verification

Use after a fully tagged/cover-embedded album is staged locally and the standard bot workflow cannot complete the import.

## 1. Write preflight

Inspect the canonical location first: use an existing album by the same artist as the layout guide. Test the **exact final album directory** with a create/remove probe using the same SSH account that will transfer. If its parent is root-owned, ask for an **album-scoped** directory/ACL repair; never change ownership recursively across the library.

## 2. Transfer without fragile rsync assumptions

Some bundled macOS `rsync` builds lack newer flags such as `--info=progress2`, and a remote-shell rsync session can behave differently from a standalone SSH probe. If rsync is unsuitable, send the staged directory through a tar stream over SSH:

```bash
/usr/bin/tar -C "$LOCAL_ALBUM" -cf - . | \
  ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_USER@$SSH_HOST" \
  "tar -C '$NAS_ALBUM' -xf -"
```

On macOS, this can create `._*` AppleDouble sidecars on the NAS. Remove only those sidecars from the newly created target folder, then verify that the count of normal `*.flac` files equals the expected track count and that `cover.jpg` exists.

```bash
ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_USER@$SSH_HOST" \
  "find '$NAS_ALBUM' -maxdepth 1 -type f -name '._*' -delete; \
   find '$NAS_ALBUM' -maxdepth 1 -type f -name '*.flac' ! -name '._*' | wc -l; \
   test -f '$NAS_ALBUM/cover.jpg'"
```

## 3. Refresh and prove Plex visibility

Run a targeted refresh first, then a plain section refresh if needed:

```bash
mtp refresh --path "$NAS_ALBUM"
mtp refresh
```

The refresh response only proves Plex accepted the request. Poll the Plex API for the album and verify **album title, artist, year, and track count**. Plex album (`type=9`) metadata uses `parentTitle` for the artist; `grandparentTitle` may be empty. To prove track visibility, request `GET /library/metadata/<ratingKey>/children` and count its metadata entries.

Treat an album as complete only after the NAS file count and Plex track count agree with canonical metadata.
