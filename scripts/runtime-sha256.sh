#!/bin/bash
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

[ -d dist ] && [ -d node_modules ] || {
  echo "runtime inputs are incomplete" >&2
  exit 1
}

find dist node_modules \( -type f -o -type l \) -print |
  LC_ALL=C sort |
  while IFS= read -r path; do
    if [ -L "$path" ]; then
      printf 'link\t%s\t%s\n' "$path" "$(readlink "$path")"
    else
      printf 'file\t%s\t%s\n' \
        "$path" \
        "$(shasum -a 256 "$path" | awk '{print $1}')"
    fi
  done |
  shasum -a 256 |
  awk '{print $1}'
