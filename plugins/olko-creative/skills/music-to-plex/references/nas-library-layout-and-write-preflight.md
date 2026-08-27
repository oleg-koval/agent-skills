# NAS library layout and write preflight

Use this before transferring a manually staged fallback album. Treat `nas_music` in app configuration as a storage root, **not proof of Plex's scanned folder layout**.

## Preflight

1. Inspect an existing album by the same artist when possible. This reveals the real Plex tree (for example, an artist-first `library/<Artist>/` layout rather than a proposed genre bucket).
2. Check that the configured SSH account can create the target directory before staging a large fallback:

```bash
ssh -i ~/.ssh/id_ed25519 -o BatchMode=yes <user>@<host> \
  "test -d '<parent>' && test -w '<parent>' && printf WRITABLE"
```

3. If the artist folder exists but is not writable, do not silently place the album in an arbitrary writable genre folder. Keep the release staged and report the permission blocker.

## Least-privilege repair

Have the NAS owner create **only the target album directory**, then grant the transfer account ownership. Avoid recursively changing ownership of the whole music library.

```bash
sudo mkdir -p "/volume1/music/library/<Artist>/<Album> (<Year>)"
sudo chown -R <transfer-user>:users "/volume1/music/library/<Artist>/<Album> (<Year>)"
sudo chmod 755 "/volume1/music/library/<Artist>/<Album> (<Year>)"
```

The `sudo` password must be entered by the NAS owner in an interactive shell; never ask them to paste it into chat. Afterward, transfer into that album-only directory, verify file count/cover/permissions, then run the Plex refresh.

## Why it matters

A successful download and correct tags do not establish Plex readiness. A wrong scanned root or non-writable parent folder can make a genre-based transfer both inaccessible to Plex and inconsistent with the existing library.
