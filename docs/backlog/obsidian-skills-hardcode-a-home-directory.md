# Obsidian skills hardcode a home directory

The skills in `olko-obsidian` contain an absolute vault path
(`/Users/oleg.koval/obsidian/...`), so they cannot work for anyone else.

The plugin now declares a `vault_path` userConfig knob. The skills still need to
read it instead of the literal path. Until then the plugin is single-user.
