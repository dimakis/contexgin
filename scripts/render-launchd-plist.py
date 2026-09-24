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


template, destination, release_dir, source_commit = map(Path, sys.argv[1:])
with template.open("rb") as stream:
    plist = plistlib.load(stream)
rendered = replace(
    plist,
    {"__RELEASE_DIR__": str(release_dir), "__SOURCE_COMMIT__": str(source_commit)},
)
with destination.open("wb") as stream:
    plistlib.dump(rendered, stream, sort_keys=False)
