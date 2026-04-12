#!/bin/bash
# ContexGin daemon start script (launched via launchd)

export PATH="/opt/homebrew/bin:$PATH"

cd /Users/dsaridak/projects/contexgin

exec node dist/cli.js serve \
  /Users/dsaridak/redhat/mgmt \
  /Users/dsaridak/projects/contexgin \
  /Users/dsaridak/projects/centaur \
  --db /Users/dsaridak/.local/share/contexgin/graph.db \
  --port 4195
