#!/bin/bash
set -euo pipefail
exec python3 "$(dirname "$0")/runtime-fingerprint.py" "${1:-.}"
