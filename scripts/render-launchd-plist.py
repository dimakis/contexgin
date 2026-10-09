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
service = sys.argv[9] if len(sys.argv) > 9 else "server"
if service not in ("server", "publisher"):
    raise ValueError("unknown ContexGin service")
previous = Path(sys.argv[10]) if len(sys.argv) > 10 else None
preserved = {}
if previous and previous.exists():
    with previous.open("rb") as stream:
        original = plistlib.load(stream)
    if original.get("Label") != "com.contexgin." + service:
        raise ValueError("previous service label mismatch")
    preserved = original.get("EnvironmentVariables", {})
if any(value and (key in ("NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH") or key.startswith("DYLD_"))
       for key, value in preserved.items()):
    raise ValueError("external runtime loading settings require investigation before deployment")
rendered["EnvironmentVariables"] = {**preserved, **rendered["EnvironmentVariables"]}
rendered["EnvironmentVariables"]["CONTEXGIN_SERVICE"] = service
origin = sys.argv[13] if len(sys.argv) > 13 else "https://github.com/dimakis/contexgin.git"
if not origin or any(character in origin for character in "\r\n\t"):
    raise ValueError("invalid deployment origin")
rendered["EnvironmentVariables"]["CONTEXGIN_DEPLOYMENT_ORIGIN"] = origin
if service == "publisher":
    rendered["EnvironmentVariables"]["CONTEXGIN_PUBLICATION_CONFIG"] = sys.argv[11]
    rendered["EnvironmentVariables"]["CONTEXGIN_GOALS_DB_PATH"] = sys.argv[12]
rendered["Label"] = "com.contexgin." + service
rendered["StandardOutPath"] = str(release_dir / "logs" / (service + "-stdout.log"))
rendered["StandardErrorPath"] = str(release_dir / "logs" / (service + "-stderr.log"))
with destination.open("wb") as stream:
    plistlib.dump(rendered, stream, sort_keys=False)
