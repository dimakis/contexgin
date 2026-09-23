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
  git diff --quiet --ignore-submodules -- || {
    echo "deployment has tracked modifications" >&2
    exit 1
  }
  if git symbolic-ref --quiet HEAD >/dev/null; then
    echo "production must run from a detached release worktree" >&2
    exit 1
  fi
fi

exec node dist/cli.js serve \
  /Users/dsaridak/redhat/mgmt \
  /Users/dsaridak/redhat/openshell \
  /Users/dsaridak/tools/mitzo \
  /Users/dsaridak/projects/contexgin \
  /Users/dsaridak/projects/centaur \
  --db /Users/dsaridak/.local/share/contexgin/graph.db \
  --port 4195
