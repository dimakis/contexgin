import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("audit", ROOT / "scripts/check-deployment.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
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
                             "CONTEXGIN_PORT": "8643" if service == "publisher" else "4195"}}
                plist_path.write_bytes(plistlib.dumps(plist))

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
                        raise audit.ProbeError()
                    return ""

                with patch.object(audit, "run", side_effect=run):
                    healthy = audit.audit_service(service, revision, home)
                    self.assertTrue(healthy["safe"])
                    self.assertFalse(healthy["stale"])
                    stale = audit.audit_service(service, "b" * 40, home)
                    self.assertTrue(stale["safe"])
                    self.assertTrue(stale["stale"])
                    (release / "dist/cli.js").write_text("changed")
                    changed = audit.audit_service(service, revision, home)
                    self.assertFalse(changed["safe"])
                    (release / "dist/cli.js").write_text("fixture")

    def test_nested_launchd_fields_cannot_replace_the_job_identity(self):
        fields = audit.job_fields("job = {\n pid = 123\n resource = {\n pid = 999\n }\n}")
        self.assertEqual(fields["pid"], "123")


if __name__ == "__main__":
    unittest.main()
