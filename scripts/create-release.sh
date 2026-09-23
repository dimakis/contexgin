#!/bin/bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_REF="${1:-HEAD}"
RELEASE_ROOT="${CONTEXGIN_RELEASE_ROOT:-$HOME/projects/contexgin-releases}"
PLIST_DEST="$HOME/Library/LaunchAgents/com.contexgin.server.plist"
DOMAIN="gui/$(id -u)"

git -C "$SOURCE_ROOT" fetch --prune origin main
SOURCE_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse --verify "$SOURCE_REF^{commit}")"
MAIN_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse --verify origin/main)"
git -C "$SOURCE_ROOT" merge-base --is-ancestor "$MAIN_COMMIT" "$SOURCE_COMMIT" || {
  echo "Refusing release: $SOURCE_COMMIT does not contain origin/main $MAIN_COMMIT" >&2
  exit 1
}
REMOTE_REF="$(git -C "$SOURCE_ROOT" branch -r --contains "$SOURCE_COMMIT" | sed -n '1{s/^[[:space:]]*//;p;}')"
[ -n "$REMOTE_REF" ] || {
  echo "Refusing release: $SOURCE_COMMIT is not published on a remote branch" >&2
  exit 1
}

mkdir -p "$RELEASE_ROOT"
RELEASE_DIR="$RELEASE_ROOT/$(printf '%s' "$SOURCE_COMMIT" | cut -c1-12)"
if [ ! -e "$RELEASE_DIR" ]; then
  git -C "$SOURCE_ROOT" worktree add --detach "$RELEASE_DIR" "$SOURCE_COMMIT"
  (
    cd "$RELEASE_DIR"
    npm ci
    npm run build
  )
fi
mkdir -p "$RELEASE_DIR/logs"

PLIST_NEXT="$(mktemp "$HOME/Library/LaunchAgents/.com.contexgin.server.XXXXXX")"
sed -e "s|__RELEASE_DIR__|$RELEASE_DIR|g" -e "s|__SOURCE_COMMIT__|$SOURCE_COMMIT|g" \
  "$RELEASE_DIR/infra/com.contexgin.server.plist" > "$PLIST_NEXT"
plutil -lint "$PLIST_NEXT" >/dev/null

PLIST_PREVIOUS=""
if [ -f "$PLIST_DEST" ]; then
  PLIST_PREVIOUS="$(mktemp "$HOME/Library/LaunchAgents/.com.contexgin.previous.XXXXXX")"
  cp "$PLIST_DEST" "$PLIST_PREVIOUS"
fi

rollback() {
  launchctl bootout "$DOMAIN/com.contexgin.server" 2>/dev/null || true
  if [ -n "$PLIST_PREVIOUS" ]; then
    mv "$PLIST_PREVIOUS" "$PLIST_DEST"
    launchctl bootstrap "$DOMAIN" "$PLIST_DEST"
  fi
}

launchctl bootout "$DOMAIN/com.contexgin.server" 2>/dev/null || true
mv "$PLIST_NEXT" "$PLIST_DEST"
launchctl bootstrap "$DOMAIN" "$PLIST_DEST"

for _ in {1..20}; do
  if curl -fsS http://127.0.0.1:4195/health >/dev/null; then
    echo "Released $SOURCE_COMMIT from $REMOTE_REF to $RELEASE_DIR"
    exit 0
  fi
  sleep 0.5
done

echo "ContexGin health check failed; restoring previous launchd deployment" >&2
rollback
exit 1
