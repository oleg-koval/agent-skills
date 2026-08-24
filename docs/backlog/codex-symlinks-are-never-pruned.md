# Codex symlinks are never pruned

`scripts/install-codex-symlinks.sh` iterates the skills currently in the catalog that declare the
`codex` adapter and creates or refreshes a symlink for each. It never removes links that are no
longer backed by a catalog entry.

So a skill removed from the catalog, renamed, or moved to a plugin whose entry drops the `codex`
adapter leaves a dangling or stale link in `~/.codex/skills`. The agent then sees a skill that the
repo no longer publishes. This behaviour predates the plugin restructure; the retarget did not
introduce it.

Fix would be a prune pass: enumerate existing `olko:*` links in the target directory, and unlink
any whose name is absent from the current catalog. Worth doing before the link set changes again.
