import importlib.util
from pathlib import Path
import plistlib
import tempfile
import contextlib
import io
import json
import sys
import shutil
import subprocess
import os
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("audit", ROOT / "scripts/check-deployment.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def test_freshness_uses_each_deployed_releases_origin(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            for service in ("server", "publisher"):
                root = home / service
                plist_path = home / "Library/LaunchAgents" / ("com.contexgin." + service + ".plist")
                plist_path.parent.mkdir(parents=True, exist_ok=True)
                plist_path.write_bytes(plistlib.dumps({"WorkingDirectory": str(root)}))
                origin = "https://example.invalid/" + service + ".git"
                revision = "c" * 40
                with patch.object(audit, "run", side_effect=[origin, revision + "\trefs/heads/main"]) as commands:
                    self.assertEqual(audit.accepted_main(service, home), revision)
                self.assertEqual(commands.call_args_list[0].args[0], ["git", "-C", str(root), "remote", "get-url", "origin"])
                self.assertEqual(commands.call_args_list[1].args[0], ["git", "ls-remote", origin, "refs/heads/main"])

    def test_read_only_check_does_not_write_bytecode_in_the_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            release = Path(temporary) / "scripts"
            release.mkdir()
            for filename in ("check-deployment.py", "runtime-fingerprint.py"):
                shutil.copy2(ROOT / "scripts" / filename, release / filename)
            result = subprocess.run([sys.executable, str(release / "check-deployment.py"), "--offline"],
                                    env={**os.environ, "HOME": temporary}, capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertFalse((release / "__pycache__").exists())

    def test_network_failure_still_audits_both_service_integrities(self):
        output = io.StringIO()
        def local(service, main):
            self.assertIsNone(main)
            return {"service": service, "safe": True, "mainChecked": False, "stale": None}
        with patch.object(sys, "argv", ["check-deployment.py"]), \
                patch.object(audit, "accepted_main", side_effect=audit.ProbeError()), \
                patch.object(audit, "audit_service", side_effect=local) as services, \
                contextlib.redirect_stdout(output):
            code = audit.main()
        self.assertEqual(code, 1)
        self.assertEqual(services.call_count, 2)
        result = json.loads(output.getvalue())
        self.assertEqual([item["service"] for item in result], ["server", "publisher"])
        self.assertTrue(all(item["safe"] for item in result))
        self.assertTrue(all(item.get("freshnessError") for item in result))

    def test_freshness_is_separate_from_integrity_for_both_services(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            release = home / "release"
            for name in ("dist", "node_modules", ".git", "scripts"):
                (release / name).mkdir(parents=True)
            (release / "dist/cli.js").write_text("fixture")
            revision = "a" * 40
            digest = audit.fingerprint(release)
            for service in ("server", "publisher"):
                label = "com.contexgin." + service
                plist_path = home / "Library/LaunchAgents" / (label + ".plist")
                plist_path.parent.mkdir(parents=True, exist_ok=True)
                plist = {"Label": label, "ProgramArguments": [str(release / "scripts/start.sh")],
                         "WorkingDirectory": str(release), "EnvironmentVariables": {
                             "CONTEXGIN_DEPLOYMENT_COMMIT": revision,
                             "CONTEXGIN_RUNTIME_SHA256": digest,
                             "CONTEXGIN_SERVICE": service,
                             "CONTEXGIN_PORT": "8643" if service == "publisher" else "4195"}}
                plist_path.write_bytes(plistlib.dumps(plist))

                symbolic_code = 1
                def run(arguments):
                    if arguments[0] == "launchctl":
                        return f"job = {{\n state = running\n pid = 123\n working directory = {release}\n path = {plist_path}\n program = {release / 'scripts/start.sh'}\n}}"
                    if arguments[0] == "lsof":
                        return "123"
                    if arguments[0] == "curl":
                        return '{"status":"ok","deploymentCommit":"' + revision + '"}'
                    if "rev-parse" in arguments:
                        return revision
                    if "symbolic-ref" in arguments:
                        raise audit.ProbeError(symbolic_code)
                    return ""

                with patch.object(audit, "run", side_effect=run):
                    healthy = audit.audit_service(service, revision, home)
                    self.assertTrue(healthy["safe"])
                    self.assertFalse(healthy["stale"])
                    for key, value in (("CONTEXGIN_SERVICE", "server" if service == "publisher" else "publisher"),
                                       ("NODE_OPTIONS", "--require /outside/release.js"),
                                       ("NODE_PATH", "/outside"), ("DYLD_INSERT_LIBRARIES", "/outside/library.dylib")):
                        original = plist["EnvironmentVariables"].get(key)
                        plist["EnvironmentVariables"][key] = value
                        plist_path.write_bytes(plistlib.dumps(plist))
                        self.assertFalse(audit.audit_service(service, revision, home)["safe"], key)
                        if original is None: del plist["EnvironmentVariables"][key]
                        else: plist["EnvironmentVariables"][key] = original
                        plist_path.write_bytes(plistlib.dumps(plist))
                    stale = audit.audit_service(service, "b" * 40, home)
                    self.assertTrue(stale["safe"])
                    self.assertTrue(stale["stale"])
                    symbolic_code = 128
                    self.assertFalse(audit.audit_service(service, revision, home)["safe"])
                    symbolic_code = 1
                    (release / "dist/cli.js").write_text("changed")
                    changed = audit.audit_service(service, revision, home)
                    self.assertFalse(changed["safe"])
                    (release / "dist/cli.js").write_text("fixture")

    def test_nested_launchd_fields_cannot_replace_the_job_identity(self):
        fields = audit.job_fields("job = {\n pid = 123\n resource = {\n pid = 999\n }\n}")
        self.assertEqual(fields["pid"], "123")


if __name__ == "__main__":
    unittest.main()
