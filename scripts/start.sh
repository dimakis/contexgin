#!/bin/bash
set -euo pipefail
# ContexGin daemon start script (launched via launchd).

export PATH="/opt/homebrew/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -n "${CONTEXGIN_DEPLOYMENT_COMMIT:-}" ]; then
  ACTUAL_COMMIT="$(git rev-parse HEAD)"
  [ "$ACTUAL_COMMIT" = "$CONTEXGIN_DEPLOYMENT_COMMIT" ] || {
    echo "deployment revision mismatch: expected $CONTEXGIN_DEPLOYMENT_COMMIT, got $ACTUAL_COMMIT" >&2
    exit 1
  }
  git diff-index --quiet HEAD -- || {
    echo "deployment has tracked modifications" >&2
    exit 1
  }
  if git symbolic-ref --quiet HEAD >/dev/null; then
    echo "production must run from a detached release worktree" >&2
    exit 1
  fi
  EXPECTED_RUNTIME_SHA256="$(cat .runtime.sha256)"
  ACTUAL_RUNTIME_SHA256="$(scripts/runtime-sha256.sh .)"
  [ "$ACTUAL_RUNTIME_SHA256" = "$EXPECTED_RUNTIME_SHA256" ] || {
    echo "deployment runtime inputs do not match the release" >&2
    exit 1
  }
fi

DEFAULT_ROOTS="$HOME/redhat/mgmt:$HOME/redhat/openshell:$HOME/tools/mitzo:$HOME/projects/contexgin:$HOME/projects/centaur"
ROOTS_VALUE="${CONTEXGIN_ROOTS:-$DEFAULT_ROOTS}"
IFS=':' read -r -a ROOTS <<< "$ROOTS_VALUE"
[ "${#ROOTS[@]}" -gt 0 ] || {
  echo "CONTEXGIN_ROOTS must contain at least one workspace root" >&2
  exit 1
}

exec node dist/cli.js serve "${ROOTS[@]}" \
  --db "${CONTEXGIN_DB_PATH:-$HOME/.local/share/contexgin/graph.db}" \
  --port "${CONTEXGIN_PORT:-4195}"
