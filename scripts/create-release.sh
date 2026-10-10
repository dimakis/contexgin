#!/bin/bash -p
set -euo pipefail
for setting in NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH BASH_ENV ENV PYTHONPATH PYTHONHOME PYTHONSTARTUP PYTHONUSERBASE PYTHONINSPECT $(compgen -A variable DYLD_); do
  [ -z "${!setting:-}" ] || {
    echo "external runtime loading settings require investigation" >&2; exit 1
  }
done

SOURCE_ROOT="${CONTEXGIN_SOURCE_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SOURCE_REF="${1:-HEAD}"
RELEASE_ROOT="${CONTEXGIN_RELEASE_ROOT:-$HOME/projects/contexgin-releases}"
SERVICE="${CONTEXGIN_SERVICE:-server}"
case "$SERVICE" in server|publisher) ;; *) echo "unknown ContexGin service" >&2; exit 1 ;; esac
LABEL="com.contexgin.$SERVICE"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
LOCK_FILE="/tmp/$LABEL.$(id -u).deploy.lock"
FAILURE_MARKER="$LOCK_FILE.failed"
assert_no_failed_rollback() {
  if [ -e "$FAILURE_MARKER" ] || [ -L "$FAILURE_MARKER" ]; then
    echo "Refusing release: failed rollback requires investigation: $FAILURE_MARKER" >&2
    return 1
  fi
}
assert_no_failed_rollback
APPLY=0
case "${2:---plan}" in
  --plan) ;;
  --apply) APPLY=1 ;;
  *) echo "Usage: create-release.sh COMMIT [--plan|--apply]" >&2; exit 1 ;;
esac
[ "$#" -le 2 ] || exit 1
DEFAULT_ROOTS="$HOME/redhat/mgmt:$HOME/redhat/openshell:$HOME/tools/mitzo:$HOME/projects/contexgin:$HOME/projects/centaur"
if [ "$SERVICE" = publisher ]; then
  DEFAULT_ROOTS=""
  [ -n "${CONTEXGIN_PUBLICATION_CONFIG:-}" ] && [ -f "$CONTEXGIN_PUBLICATION_CONFIG" ] &&
    [ "${CONTEXGIN_PUBLICATION_CONFIG#/}" != "$CONTEXGIN_PUBLICATION_CONFIG" ] || {
    echo "publisher requires an existing absolute publication configuration" >&2; exit 1
  }
  case "${CONTEXGIN_DB_PATH:-}" in /*) ;; *) echo "publisher requires explicit absolute graph and goals database paths" >&2; exit 1 ;; esac
  case "${CONTEXGIN_GOALS_DB_PATH:-}" in /*) ;; *) echo "publisher requires explicit absolute graph and goals database paths" >&2; exit 1 ;; esac
fi
SERVE_ROOTS="${CONTEXGIN_ROOTS:-$DEFAULT_ROOTS}"
SERVE_DB_PATH="${CONTEXGIN_DB_PATH:-$HOME/.local/share/contexgin/graph.db}"
DEFAULT_PORT=4195
[ "$SERVICE" != publisher ] || DEFAULT_PORT=8643
SERVE_PORT="${CONTEXGIN_PORT:-$DEFAULT_PORT}"
case "$SERVE_PORT" in
  *[!0-9]*|'') echo "Refusing release: service port must be an integer" >&2; exit 1 ;;
esac
[ "$SERVE_PORT" -ge 1 ] && [ "$SERVE_PORT" -le 65535 ] || exit 1
STARTUP_TIMEOUT_SECONDS="${CONTEXGIN_STARTUP_TIMEOUT_SECONDS:-120}"
RELEASE_TEMP=""
RELEASE_INSTALL_LOCK="$RELEASE_ROOT/.release-install.lock"
RELEASE_INSTALL_LOCK_HELD=0
CUTOVER_ACTIVE=0
PLIST_PREVIOUS=""
PLIST_NEXT=""
PREVIOUS_COMMIT=""
PREVIOUS_PORT="4195"
PREVIOUS_WORKING_DIRECTORY=""
PREVIOUS_ALLOW_LEGACY_DIRECTORY=0
PREVIOUS_PROGRAM=""

case "$STARTUP_TIMEOUT_SECONDS" in
  *[!0-9]*|'') echo "Refusing release: CONTEXGIN_STARTUP_TIMEOUT_SECONDS must be an integer" >&2; exit 1 ;;
esac
[ "$STARTUP_TIMEOUT_SECONDS" -ge 10 ] && [ "$STARTUP_TIMEOUT_SECONDS" -le 600 ] || {
  echo "Refusing release: CONTEXGIN_STARTUP_TIMEOUT_SECONDS must be between 10 and 600" >&2
  exit 1
}
if [ "$SERVICE" = server ]; then
case ":$SERVE_ROOTS:" in
  *::* ) echo "Refusing release: CONTEXGIN_ROOTS contains an empty workspace root" >&2; exit 1 ;;
esac
IFS=':' read -r -a SERVE_ROOT_LIST <<< "$SERVE_ROOTS"
NORMALIZED_SERVE_ROOTS=""
for root in "${SERVE_ROOT_LIST[@]}"; do
  case "$root" in
    '~') root="$HOME" ;;
    '~/'*) root="$HOME/${root#\~/}" ;;
  esac
  [ "${root#/}" != "$root" ] && [ -d "$root" ] || {
    echo "Refusing release: every CONTEXGIN_ROOTS entry must be an existing absolute directory" >&2
    exit 1
  }
  root="$(cd "$root" && pwd -P)"
  NORMALIZED_SERVE_ROOTS="${NORMALIZED_SERVE_ROOTS:+$NORMALIZED_SERVE_ROOTS:}$root"
done
SERVE_ROOTS="$NORMALIZED_SERVE_ROOTS"
else
  SERVE_ROOTS=""
fi
PROBE_ROOT="${CONTEXGIN_PROBE_ROOT:-${SERVE_ROOTS%%:*}}"

mkdir -p "$RELEASE_ROOT" "$HOME/Library/LaunchAgents"
if [ "$SERVE_DB_PATH" != ":memory:" ]; then
  case "$SERVE_DB_PATH" in
    /*) mkdir -p "$(dirname "$SERVE_DB_PATH")" ;;
    *) echo "Refusing release: CONTEXGIN_DB_PATH must be absolute or :memory:" >&2; exit 1 ;;
  esac
fi
if [ -n "${CONTEXGIN_GOALS_DB_PATH:-}" ]; then
  case "$CONTEXGIN_GOALS_DB_PATH" in
    /*) mkdir -p "$(dirname "$CONTEXGIN_GOALS_DB_PATH")" ;;
    *) echo "Refusing release: goals database path must be absolute" >&2; exit 1 ;;
  esac
fi
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

wait_for_deployment_health() {
  local port="$1"
  local expected_commit="$2"
  local expected_working_directory="$3"
  local allow_legacy_directory="${4:-0}"
  local expected_program="${5:-}"
  local observed_working_directory
  local observed_program
  local observed_registration
  local process_directory
  local health_json
  local job_output
  local job_pid
  local listener_pids
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    job_output="$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null || true)"
    if ! printf '%s\n' "$job_output" | grep -Eq '^[[:space:]]+state = running$'; then
      sleep 0.5
      continue
    fi
    job_pid="$(printf '%s\n' "$job_output" | awk '$1 == "pid" && $2 == "=" { print $3; exit }')"
    observed_working_directory="$(printf '%s\n' "$job_output" | sed -n 's/^[[:space:]]*working directory = //p' | head -1)"
    if [ "$observed_working_directory" != "$expected_working_directory" ]; then
      if [ "$allow_legacy_directory" != 1 ] || [ -n "$observed_working_directory" ] || [ -z "$expected_program" ] || [ -z "$job_pid" ]; then
        sleep 0.5; continue
      fi
      observed_program="$(printf '%s\n' "$job_output" | sed -n 's/^[[:space:]]*program = //p' | head -1)"
      observed_registration="$(printf '%s\n' "$job_output" | sed -n 's/^[[:space:]]*path = //p' | head -1)"
      if [ "$observed_program" != "$expected_program" ] || [ "$observed_registration" != "$PLIST_DEST" ]; then
        sleep 0.5; continue
      fi
      process_directory="$(lsof -a -p "$job_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
      if [ "$process_directory" != "$expected_working_directory" ]; then
        sleep 0.5; continue
      fi
    fi
    listener_pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [ -z "$job_pid" ] || ! printf '%s\n' "$listener_pids" | grep -Fxq "$job_pid"; then
      sleep 0.5
      continue
    fi
    health_json="$(curl -fsS --connect-timeout 2 --max-time 5 "http://127.0.0.1:$port/health" 2>/dev/null || true)"
    if [ -n "$health_json" ]; then
      node -e 'const h=JSON.parse(process.argv[1]); if(h.status!=="ok"||(process.argv[2]&&h.deploymentCommit!==process.argv[2])) process.exit(1)' "$health_json" "$expected_commit" 2>/dev/null && return 0
    fi
    sleep 0.5
  done
  return 1
}

rollback() {
  if ! bootout_and_wait; then
    echo "ROLLBACK FAILED: rejected ContexGin job could not be stopped" >&2
    return 1
  fi
  if [ -n "$PLIST_PREVIOUS" ] && [ -f "$PLIST_PREVIOUS" ]; then
    if ! mv "$PLIST_PREVIOUS" "$PLIST_DEST"; then
      echo "ROLLBACK FAILED: previous ContexGin plist could not be restored" >&2
      return 1
    fi
    PLIST_PREVIOUS=""
    if ! bootstrap_with_retry; then
      echo "ROLLBACK FAILED: previous ContexGin plist could not be bootstrapped" >&2
      return 1
    fi
    if ! wait_for_deployment_health "$PREVIOUS_PORT" "$PREVIOUS_COMMIT" "$PREVIOUS_WORKING_DIRECTORY"; then
      echo "ROLLBACK FAILED: previous ContexGin deployment did not become healthy" >&2
      return 1
    fi
  elif [ -f "$PLIST_DEST" ]; then
    mv "$PLIST_DEST" "${PLIST_DEST}.failed"
  fi
}

cleanup() {
  local status=$?
  local rollback_failed=0
  trap - EXIT INT TERM HUP
  if [ "$CUTOVER_ACTIVE" = "1" ] && ! rollback; then
    rollback_failed=1
    status=1
  fi
  [ -z "$PLIST_NEXT" ] || [ ! -f "$PLIST_NEXT" ] || mv "$PLIST_NEXT" "${PLIST_NEXT}.abandoned"
  if [ -n "$RELEASE_TEMP" ] && [ -d "$RELEASE_TEMP" ]; then rm -rf -- "$RELEASE_TEMP"; fi
  if [ "${RELEASE_INSTALL_LOCK_HELD:-0}" = 1 ]; then rm -f -- "$RELEASE_INSTALL_LOCK"; fi
  if [ "$rollback_failed" != "1" ]; then rm -f -- "$LOCK_FILE"; fi
  if [ "$rollback_failed" = "1" ]; then
    (umask 077; set -o noclobber; printf 'rollback_failed\nlabel=%s\nsource=%s\n' "$LABEL" "$SOURCE_COMMIT" > "$FAILURE_MARKER") || true
    echo "ContexGin rollback failed; inspect $PLIST_DEST and retained release directories" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
assert_no_failed_rollback

git -C "$SOURCE_ROOT" fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'
SOURCE_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse --verify "$SOURCE_REF^{commit}")"
MAIN_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse --verify origin/main)"
[ "$SOURCE_COMMIT" = "$MAIN_COMMIT" ] || {
  echo "Refusing release: production requires exact accepted main" >&2
  exit 1
}
REMOTE_REF="$(git -C "$SOURCE_ROOT" for-each-ref --format='%(refname:short) %(symref)' --contains "$SOURCE_COMMIT" refs/remotes/origin | awk 'NF == 1 { print $1; exit }')"
[ -n "$REMOTE_REF" ] || {
  echo "Refusing release: $SOURCE_COMMIT is not published on a remote branch" >&2
  exit 1
}

if [ "$APPLY" = 1 ]; then
  CONTROLLER_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  [ "$(git -C "$CONTROLLER_ROOT" rev-parse HEAD)" = "$SOURCE_COMMIT" ] &&
    git -C "$CONTROLLER_ROOT" diff-index --quiet HEAD -- || {
    echo "Refusing release: apply controller must be clean accepted main" >&2; exit 1
  }
fi
runtime_sha256() { "$1/scripts/runtime-sha256.sh" "$1"; }
RELEASE_TEMP="$(mktemp -d "$RELEASE_ROOT/.build.XXXXXX")"
git clone --no-local --no-checkout "$SOURCE_ROOT" "$RELEASE_TEMP/release"
ORIGIN_URL="$(git -C "$SOURCE_ROOT" remote get-url origin)"
REMOTE_BRANCH="${REMOTE_REF#origin/}"
git -C "$RELEASE_TEMP/release" remote set-url origin "$ORIGIN_URL"
git -C "$RELEASE_TEMP/release" fetch --no-tags origin \
  "+refs/heads/$REMOTE_BRANCH:refs/remotes/origin/$REMOTE_BRANCH"
git -C "$RELEASE_TEMP/release" merge-base --is-ancestor \
  "$SOURCE_COMMIT" "refs/remotes/origin/$REMOTE_BRANCH" || {
  echo "Refusing release: $SOURCE_COMMIT is no longer published on $REMOTE_REF" >&2
  exit 1
}
git -C "$RELEASE_TEMP/release" checkout --detach "$SOURCE_COMMIT"
(
  cd "$RELEASE_TEMP/release"
  npm ci
  npm run build
)
BUILT_RUNTIME_SHA256="$(runtime_sha256 "$RELEASE_TEMP/release")"
printf '%s\n' "$BUILT_RUNTIME_SHA256" > "$RELEASE_TEMP/release/.runtime.sha256"
RELEASE_DIR="$RELEASE_ROOT/$(printf '%s' "$SOURCE_COMMIT" | cut -c1-12)-$BUILT_RUNTIME_SHA256"
release_is_valid() {
  [ -d "$RELEASE_DIR/.git" ] &&
    [ "$(git -C "$RELEASE_DIR" rev-parse HEAD 2>/dev/null)" = "$SOURCE_COMMIT" ] &&
    ! git -C "$RELEASE_DIR" symbolic-ref --quiet HEAD >/dev/null 2>&1 &&
    git -C "$RELEASE_DIR" diff-index --quiet HEAD -- &&
    [ "$(runtime_sha256 "$RELEASE_DIR")" = "$BUILT_RUNTIME_SHA256" ]
}
if ! shlock -f "$RELEASE_INSTALL_LOCK" -p "$$"; then
  echo "Refusing release: shared release installation is active" >&2; exit 1
fi
RELEASE_INSTALL_LOCK_HELD=1
if [ -e "$RELEASE_DIR" ] && ! release_is_valid; then
  echo "Refusing release: immutable release directory is invalid: $RELEASE_DIR" >&2
  exit 1
fi
if [ -e "$RELEASE_DIR" ]; then
  rm -rf -- "$RELEASE_TEMP"
else
  mv "$RELEASE_TEMP/release" "$RELEASE_DIR"
  rmdir "$RELEASE_TEMP"
fi
rm -f -- "$RELEASE_INSTALL_LOCK"
RELEASE_INSTALL_LOCK_HELD=0
RELEASE_TEMP=""
mkdir -p "$RELEASE_DIR/logs"

PLIST_NEXT="$(mktemp "$HOME/Library/LaunchAgents/.$LABEL.XXXXXX")"
python3 -I "$RELEASE_DIR/scripts/render-launchd-plist.py" \
  "$RELEASE_DIR/infra/com.contexgin.server.plist" \
  "$PLIST_NEXT" \
  "$RELEASE_DIR" \
  "$SOURCE_COMMIT" \
  "$SERVE_ROOTS" \
  "$SERVE_DB_PATH" \
  "$SERVE_PORT" \
  "$BUILT_RUNTIME_SHA256" \
  "$SERVICE" "$PLIST_DEST" "${CONTEXGIN_PUBLICATION_CONFIG:-}" "${CONTEXGIN_GOALS_DB_PATH:-}" "$ORIGIN_URL"
chmod 600 "$PLIST_NEXT"
plutil -lint "$PLIST_NEXT" >/dev/null

if [ "$APPLY" = 0 ]; then
  echo "Planned $LABEL at $SOURCE_COMMIT in $RELEASE_DIR; rerun with --apply"
  exit 0
fi
# Main may advance during the build. Never cut over to a superseded selection.
FRESH_MAIN="$(git -C "$SOURCE_ROOT" ls-remote origin refs/heads/main | awk '{print $1}')"
[ "$FRESH_MAIN" = "$SOURCE_COMMIT" ] || {
  echo "Refusing release: accepted main advanced during preparation" >&2; exit 1
}
if [ -f "$PLIST_DEST" ]; then
  PLIST_PREVIOUS="$(mktemp "$HOME/Library/LaunchAgents/.$LABEL.previous.XXXXXX")"
  cp "$PLIST_DEST" "$PLIST_PREVIOUS"
  PREVIOUS_COMMIT="$(plutil -extract EnvironmentVariables.CONTEXGIN_DEPLOYMENT_COMMIT raw -o - "$PLIST_PREVIOUS" 2>/dev/null || true)"
  PREVIOUS_PORT="$(plutil -extract EnvironmentVariables.CONTEXGIN_PORT raw -o - "$PLIST_PREVIOUS" 2>/dev/null || true)"
  if [ -z "$PREVIOUS_PORT" ]; then
    PREVIOUS_PORT="${CONTEXGIN_LEGACY_PORT:-}"
    [ -n "$PREVIOUS_PORT" ] || {
      echo "Refusing release: previous plist has no port; set CONTEXGIN_LEGACY_PORT for the first guarded deployment" >&2
      exit 1
    }
  fi
  case "$PREVIOUS_PORT" in
    *[!0-9]*|'') echo "Refusing release: previous ContexGin port is invalid" >&2; exit 1 ;;
  esac
  [ "$PREVIOUS_PORT" -ge 1 ] && [ "$PREVIOUS_PORT" -le 65535 ] || {
    echo "Refusing release: previous ContexGin port is invalid" >&2
    exit 1
  }
  PREVIOUS_WORKING_DIRECTORY="$(plutil -extract WorkingDirectory raw -o - "$PLIST_PREVIOUS" 2>/dev/null || true)"
  if [ -z "$PREVIOUS_WORKING_DIRECTORY" ]; then
    PREVIOUS_ALLOW_LEGACY_DIRECTORY=1
    PREVIOUS_PROGRAM="$(plutil -extract ProgramArguments.0 raw -o - "$PLIST_PREVIOUS" 2>/dev/null || true)"
    if [ -n "$PREVIOUS_PROGRAM" ] && [ "${PREVIOUS_PROGRAM#/}" != "$PREVIOUS_PROGRAM" ]; then
      PREVIOUS_WORKING_DIRECTORY="$(git -C "$(dirname "$PREVIOUS_PROGRAM")" rev-parse --show-toplevel 2>/dev/null || true)"
    fi
    PREVIOUS_WORKING_DIRECTORY="${PREVIOUS_WORKING_DIRECTORY:-${CONTEXGIN_LEGACY_WORKING_DIRECTORY:-}}"
    if [ -n "$PREVIOUS_WORKING_DIRECTORY" ]; then
      plutil -insert WorkingDirectory -string "$PREVIOUS_WORKING_DIRECTORY" "$PLIST_PREVIOUS"
    fi
  fi
  [ -n "$PREVIOUS_WORKING_DIRECTORY" ] || {
    echo "Refusing release: cannot derive the legacy working directory; set CONTEXGIN_LEGACY_WORKING_DIRECTORY for the first guarded deployment" >&2
    exit 1
  }
  # The first transition can restore the exact legacy launcher, whose health
  # response predates commit attestation. Require the explicit legacy port.
  if [ -n "${CONTEXGIN_LEGACY_PORT:-}" ]; then
    LEGACY_HEALTH="$(curl -fsS --connect-timeout 2 --max-time 5 "http://127.0.0.1:$PREVIOUS_PORT/health")"
    if node -e 'const h=JSON.parse(process.argv[1]);process.exit(h.deploymentCommit==null?0:1)' "$LEGACY_HEALTH"; then
      [ "$(git -C "$PREVIOUS_WORKING_DIRECTORY" rev-parse HEAD)" = "${PREVIOUS_COMMIT:-$(git -C "$PREVIOUS_WORKING_DIRECTORY" rev-parse HEAD)}" ] || exit 1
      PREVIOUS_COMMIT=""
    fi
  fi
  [ "${PREVIOUS_WORKING_DIRECTORY#/}" != "$PREVIOUS_WORKING_DIRECTORY" ] && [ -d "$PREVIOUS_WORKING_DIRECTORY" ] || {
    echo "Refusing release: previous ContexGin working directory is not an existing absolute directory" >&2
    exit 1
  }
fi

if [ -n "$PLIST_PREVIOUS" ]; then
  wait_for_deployment_health "$PREVIOUS_PORT" "$PREVIOUS_COMMIT" "$PREVIOUS_WORKING_DIRECTORY" "$PREVIOUS_ALLOW_LEGACY_DIRECTORY" "$PREVIOUS_PROGRAM" || {
    echo "Refusing release: original deployment ownership is uncertain" >&2; exit 1
  }
fi
# Original-owner readiness may wait for a rebuild. Bind freshness again at
# the last point before controlling the original service.
FRESH_MAIN="$(git -C "$SOURCE_ROOT" ls-remote origin refs/heads/main | awk '{print $1}')"
[ "$FRESH_MAIN" = "$SOURCE_COMMIT" ] || {
  echo "Refusing release: accepted main advanced before cutover" >&2; exit 1
}
if [ -z "$PLIST_PREVIOUS" ] && launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "Refusing release: registered job has no verified rollback configuration" >&2; exit 1
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

if wait_for_deployment_health "$SERVE_PORT" "$SOURCE_COMMIT" "$RELEASE_DIR"; then
  PROBE_BODY="$(node -e 'process.stdout.write(JSON.stringify({spoke:process.argv[1],budget:12000}))' "$PROBE_ROOT")"
  if [ "$SERVICE" = publisher ] || curl -fsS --connect-timeout 2 --max-time 15 \
    -H 'content-type: application/json' \
    -d "$PROBE_BODY" \
    "http://127.0.0.1:$SERVE_PORT/compile" >/dev/null; then
    CUTOVER_ACTIVE=0
    [ -z "$PLIST_PREVIOUS" ] || [ ! -f "$PLIST_PREVIOUS" ] || mv "$PLIST_PREVIOUS" "${PLIST_PREVIOUS}.retired"
    echo "Released $SOURCE_COMMIT from $REMOTE_REF to $RELEASE_DIR"
    exit 0
  fi
fi

echo "ContexGin health or configured-root compile check failed; restoring previous deployment" >&2
exit 1
