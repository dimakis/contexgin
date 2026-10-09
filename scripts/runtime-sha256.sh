#!/bin/bash -p
set -euo pipefail
exec python3 -I "$(dirname "$0")/runtime-fingerprint.py" "${1:-.}"
