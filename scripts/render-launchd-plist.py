#!/usr/bin/env python3
import plistlib
import sys
from pathlib import Path


def replace(value: object, replacements: dict[str, str]) -> object:
    if isinstance(value, str):
        for marker, replacement in replacements.items():
            value = value.replace(marker, replacement)
        return value
    if isinstance(value, list):
        return [replace(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: replace(item, replacements) for key, item in value.items()}
    return value


template = Path(sys.argv[1])
destination = Path(sys.argv[2])
release_dir = Path(sys.argv[3])
source_commit = sys.argv[4]
serve_roots = sys.argv[5]
db_path = sys.argv[6]
port = sys.argv[7]
runtime_sha256 = sys.argv[8]
with template.open("rb") as stream:
    plist = plistlib.load(stream)
replacements = {"__RELEASE_DIR__": str(release_dir)}
replacements["__SOURCE_COMMIT__"] = source_commit
replacements["__SERVE_ROOTS__"] = serve_roots
replacements["__DB_PATH__"] = db_path
replacements["__PORT__"] = port
replacements["__RUNTIME_SHA256__"] = runtime_sha256
rendered = replace(plist, replacements)
with destination.open("wb") as stream:
    plistlib.dump(rendered, stream, sort_keys=False)
