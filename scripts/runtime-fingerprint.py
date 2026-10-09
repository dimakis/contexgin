#!/usr/bin/env python3
"""Hash the complete contained runtime closure, without following directory links."""
import hashlib
import json
from pathlib import Path
import stat
import sys


def fingerprint(root: Path) -> str:
    root = root.resolve(strict=True)
    digest = hashlib.sha256(b"contexgin-runtime-v2\n")

    def visit(path: Path) -> None:
        metadata = path.lstat()
        relative = str(path.relative_to(root))
        mode = stat.S_IMODE(metadata.st_mode)
        if path.is_symlink():
            target = path.resolve(strict=True)
            if not any(target.is_relative_to(root / name) for name in ("dist", "node_modules")):
                raise ValueError("symlink target outside runtime closure")
            row = [relative, "link", mode, path.readlink().as_posix()]
        elif stat.S_ISDIR(metadata.st_mode):
            row = [relative, "directory", mode]
        elif stat.S_ISREG(metadata.st_mode):
            payload = hashlib.sha256()
            with path.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    payload.update(block)
            row = [relative, "file", mode, payload.hexdigest()]
        else:
            raise ValueError("unsupported runtime file type")
        digest.update(json.dumps(row, ensure_ascii=True, separators=(",", ":")).encode() + b"\n")
        if stat.S_ISDIR(metadata.st_mode):
            for child in sorted(path.iterdir(), key=lambda p: p.name):
                visit(child)

    for name in ("dist", "node_modules"):
        path = root / name
        if path.is_symlink() or not path.is_dir():
            raise ValueError("runtime inputs are incomplete")
        visit(path)
    return digest.hexdigest()


if __name__ == "__main__":
    try:
        print(fingerprint(Path(sys.argv[1])))
    except (OSError, ValueError, RuntimeError):
        # Avoid exposing private paths or file contents in diagnostics.
        print("runtime inputs invalid or symlink target outside runtime closure", file=sys.stderr)
        sys.exit(1)
