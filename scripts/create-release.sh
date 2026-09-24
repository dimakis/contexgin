#!/bin/bash
set -euo pipefail

SOURCE_ROOT="${CONTEXGIN_SOURCE_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SOURCE_REF="${1:-HEAD}"
RELEASE_ROOT="${CONTEXGIN_RELEASE_ROOT:-$HOME/projects/contexgin-releases}"
PLIST_DEST="$HOME/Library/LaunchAgents/com.contexgin.server.plist"
DOMAIN="gui/$(id -u)"
LABEL="com.contexgin.server"
LOCK_FILE="/tmp/com.contexgin.server.$(id -u).deploy.lock"
RELEASE_TEMP=""
CUTOVER_ACTIVE=0
PLIST_PREVIOUS=""
PLIST_NEXT=""

mkdir -p "$RELEASE_ROOT" "$HOME/Library/LaunchAgents"
if ! shlock -f "$LOCK_FILE" -p "$$"; then
  echo "Refusing release: another ContexGin deployment is active" >&2
  exit 1
fi

bootout_and_wait() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  for _ in {1..50}; do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.1
  done
  return 1
}

bootstrap_with_retry() {
  for _ in {1..10}; do
    launchctl bootstrap "$DOMAIN" "$PLIST_DEST" && return 0
    sleep 0.2
  done
  return 1
}

rollback() {
  bootout_and_wait || true
  if [ -n "$PLIST_PREVIOUS" ] && [ -f "$PLIST_PREVIOUS" ]; then
    mv "$PLIST_PREVIOUS" "$PLIST_DEST"
    bootstrap_with_retry || true
  elif [ -f "$PLIST_DEST" ]; then
    mv "$PLIST_DEST" "${PLIST_DEST}.failed"
  fi
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [ "$CUTOVER_ACTIVE" = "1" ]; then rollback; fi
  [ -z "$PLIST_NEXT" ] || [ ! -f "$PLIST_NEXT" ] || mv "$PLIST_NEXT" "${PLIST_NEXT}.abandoned"
  if [ -n "$RELEASE_TEMP" ] && [ -d "$RELEASE_TEMP" ]; then rm -rf -- "$RELEASE_TEMP"; fi
  rm -f -- "$LOCK_FILE"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

git -C "$SOURCE_ROOT" fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'
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

RELEASE_DIR="$RELEASE_ROOT/$(printf '%s' "$SOURCE_COMMIT" | cut -c1-12)"
release_is_valid() {
  [ -d "$RELEASE_DIR/.git" ] &&
    [ "$(git -C "$RELEASE_DIR" rev-parse HEAD 2>/dev/null)" = "$SOURCE_COMMIT" ] &&
    ! git -C "$RELEASE_DIR" symbolic-ref --quiet HEAD >/dev/null 2>&1 &&
    git -C "$RELEASE_DIR" diff-index --quiet HEAD -- &&
    [ -s "$RELEASE_DIR/.dist.sha256" ]
}
if [ -e "$RELEASE_DIR" ] && ! release_is_valid; then
  mv "$RELEASE_DIR" "${RELEASE_DIR}.invalid.$(date +%s)"
fi
if [ ! -e "$RELEASE_DIR" ]; then
  RELEASE_TEMP="$(mktemp -d "$RELEASE_ROOT/.build.XXXXXX")"
  git clone --no-local --no-checkout "$SOURCE_ROOT" "$RELEASE_TEMP/release"
  git -C "$RELEASE_TEMP/release" checkout --detach "$SOURCE_COMMIT"
  (
    cd "$RELEASE_TEMP/release"
    npm ci
    npm run build
    find dist -type f -exec shasum -a 256 {} \; | LC_ALL=C sort | shasum -a 256 | awk '{print $1}' > .dist.sha256
  )
  mv "$RELEASE_TEMP/release" "$RELEASE_DIR"
  rmdir "$RELEASE_TEMP"
  RELEASE_TEMP=""
fi
mkdir -p "$RELEASE_DIR/logs"

PLIST_NEXT="$(mktemp "$HOME/Library/LaunchAgents/.com.contexgin.server.XXXXXX")"
sed -e "s|__RELEASE_DIR__|$RELEASE_DIR|g" -e "s|__SOURCE_COMMIT__|$SOURCE_COMMIT|g" \
  "$RELEASE_DIR/infra/com.contexgin.server.plist" > "$PLIST_NEXT"
plutil -lint "$PLIST_NEXT" >/dev/null

if [ -f "$PLIST_DEST" ]; then
  PLIST_PREVIOUS="$(mktemp "$HOME/Library/LaunchAgents/.com.contexgin.previous.XXXXXX")"
  cp "$PLIST_DEST" "$PLIST_PREVIOUS"
fi

CUTOVER_ACTIVE=1
if ! bootout_and_wait; then
  echo "ContexGin shutdown timed out; restoring previous deployment" >&2
  exit 1
fi
mv "$PLIST_NEXT" "$PLIST_DEST"
PLIST_NEXT=""
if ! bootstrap_with_retry; then
  echo "ContexGin launchd registration failed; restoring previous deployment" >&2
  exit 1
fi

for _ in {1..20}; do
  HEALTH_JSON="$(curl -fsS http://127.0.0.1:4195/health 2>/dev/null || true)"
  if node -e 'const h=JSON.parse(process.argv[1]); if(h.deploymentCommit!==process.argv[2]) process.exit(1)' "$HEALTH_JSON" "$SOURCE_COMMIT" 2>/dev/null && \
    curl -fsS --max-time 15 \
      -H 'content-type: application/json' \
      -d '{"spoke":"/Users/dsaridak/tools/mitzo","budget":12000}' \
      http://127.0.0.1:4195/compile >/dev/null; then
    CUTOVER_ACTIVE=0
    [ -z "$PLIST_PREVIOUS" ] || [ ! -f "$PLIST_PREVIOUS" ] || mv "$PLIST_PREVIOUS" "${PLIST_PREVIOUS}.retired"
    echo "Released $SOURCE_COMMIT from $REMOTE_REF to $RELEASE_DIR"
    exit 0
  fi
  sleep 0.5
done

echo "ContexGin health or configured-root compile check failed; restoring previous deployment" >&2
exit 1
