#!/usr/bin/env python3
"""Read-only integrity, runtime ownership and main freshness check for both services."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("runtime", Path(__file__).with_name("runtime-fingerprint.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
fingerprint = runtime.fingerprint


class ProbeError(Exception):
    pass


def run(arguments):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ProbeError(result.returncode)
    return result.stdout.strip()


def job_fields(output):
    depth = 0
    fields = {}
    for line in output.splitlines():
        if depth == 1 and " = " in line:
            key, value = line.strip().split(" = ", 1)
            fields[key] = value
        depth += line.count("{") - line.count("}")
    return fields


def accepted_main(service, home=None):
    home = home or Path.home()
    with (home / "Library/LaunchAgents" / ("com.contexgin." + service + ".plist")).open("rb") as stream:
        root = plistlib.load(stream)["WorkingDirectory"]
    origin = run(["git", "-C", root, "remote", "get-url", "origin"])
    revision = run(["git", "ls-remote", origin, "refs/heads/main"]).split()[0]
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ProbeError()
    return revision


def audit_service(service, main, home=None):
    home = home or Path.home()
    label = "com.contexgin." + service
    result = {"service": service, "safe": False, "source": None, "main": main,
              "mainChecked": main is not None, "stale": None}
    try:
        plist_path = home / "Library/LaunchAgents" / (label + ".plist")
        with plist_path.open("rb") as stream:
            plist = plistlib.load(stream)
        environment = plist["EnvironmentVariables"]
        if environment.get("CONTEXGIN_SERVICE") != service or any(
            value and (key in ("NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH") or key.startswith("DYLD_"))
            for key, value in environment.items()
        ):
            raise ProbeError()
        source = environment["CONTEXGIN_DEPLOYMENT_COMMIT"]
        expected_digest = environment["CONTEXGIN_RUNTIME_SHA256"]
        if not re.fullmatch(r"[a-f0-9]{40}", source) or not re.fullmatch(r"[a-f0-9]{64}", expected_digest):
            raise ProbeError()
        result.update(source=source, stale=None if main is None else source != main)
        root = Path(plist["WorkingDirectory"])
        if plist["Label"] != label or plist["ProgramArguments"] != [str(root / "scripts/start.sh")]:
            raise ProbeError()
        fields = job_fields(run(["launchctl", "print", f"gui/{os.getuid()}/{label}"]))
        if (fields.get("state") != "running" or fields.get("working directory") != str(root)
                or fields.get("path") != str(plist_path)
                or fields.get("program") != str(root / "scripts/start.sh")):
            raise ProbeError()
        pid = fields["pid"]
        port = environment["CONTEXGIN_PORT"]
        if not pid.isdigit() or not port.isdigit() or not 1 <= int(port) <= 65535:
            raise ProbeError()
        listeners = set(run(["lsof", "-nP", "-iTCP:" + port, "-sTCP:LISTEN", "-t"]).split())
        if listeners != {pid}:
            raise ProbeError()
        if run(["git", "-C", str(root), "rev-parse", "HEAD"]) != source:
            raise ProbeError()
        run(["git", "-C", str(root), "diff-index", "--quiet", "HEAD", "--"])
        # symbolic-ref must fail for a detached HEAD. Verify the Git directory first.
        if not (root / ".git").is_dir():
            raise ProbeError()
        try:
            run(["git", "-C", str(root), "symbolic-ref", "--quiet", "HEAD"])
        except ProbeError as error:
            if error.args != (1,):
                raise
        else:
            raise ProbeError()
        if fingerprint(root) != expected_digest:
            raise ProbeError()
        health = json.loads(run(["curl", "-fsS", "--max-time", "5", f"http://127.0.0.1:{port}/health"]))
        if health.get("status") != "ok" or health.get("deploymentCommit") != source:
            raise ProbeError()
        result.update(safe=True, pid=int(pid), port=int(port))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.TimeoutExpired, ProbeError):
        result["error"] = "Deployment identity or integrity could not be verified; no changes made"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=("server", "publisher", "all"), default="all")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    services = ("server", "publisher") if args.service == "all" else (args.service,)
    results = []
    for service in services:
        revision = None
        freshness_error = None
        if not args.offline:
            try:
                revision = accepted_main(service)
            except (ProbeError, OSError, KeyError, TypeError, ValueError, IndexError, subprocess.TimeoutExpired):
                freshness_error = "Main freshness unavailable"
        item = audit_service(service, revision)
        if freshness_error:
            item["freshnessError"] = freshness_error
        results.append(item)
    print(json.dumps(results))
    return 0 if all(item["safe"] and item["stale"] is not True and not item.get("freshnessError") for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
