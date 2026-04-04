#!/bin/sh
set -eu

CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
PACKAGES_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../packages" && pwd)"

mkdir -p "$CODEX_SKILLS_DIR"

for pkg in "$PACKAGES_DIR"/*; do
  [ -d "$pkg" ] || continue
  name="$(basename "$pkg")"
  ln -sfn "$pkg" "$CODEX_SKILLS_DIR/$name"
  echo "linked $name -> $pkg"
done
