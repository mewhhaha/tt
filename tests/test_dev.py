#!/usr/bin/env python3
"""The local driver fails closed and never needs a CI service."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tt_dev", ROOT / "dev.py")
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class LocalWorkflowTests(unittest.TestCase):
    def test_missing_tool_does_not_download(self):
        with patch.object(dev.shutil, "which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "no CI fallback"):
                dev.require("absent-compiler")

    def test_compiler_can_be_selected(self):
        args = dev.arguments(["verify", "--compiler", "custom-c++"])
        with patch.object(dev, "require", return_value="/tools/custom-c++") as lookup:
            self.assertEqual(dev.compiler_for(args), "/tools/custom-c++")
            lookup.assert_called_once_with("custom-c++")

    def test_zero_jobs_rejected(self):
        with self.assertRaises(SystemExit):
            dev.arguments(["build", "--jobs", "0"])

    def test_build_failure_is_not_success(self):
        with patch.object(dev, "build", side_effect=subprocess.CalledProcessError(1, "cmake")):
            self.assertEqual(dev.main(["verify"]), 1)

    def test_test_failure_stops_before_benchmarks(self):
        with patch.object(dev, "build", return_value=ROOT / "build"), \
                patch.object(dev, "tests", side_effect=RuntimeError("test failed")), \
                patch.object(dev, "benchmarks") as benchmark:
            self.assertEqual(dev.main(["verify"]), 1)
            benchmark.assert_not_called()

    def test_doctor_outside_repository(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run([sys.executable, str(ROOT / "dev.py"), "doctor"],
                                    cwd=temporary, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Local prerequisites found", result.stdout)

    def test_help_needs_no_toolchain(self):
        env = {**os.environ, "PATH": ""}
        result = subprocess.run([sys.executable, str(ROOT / "dev.py"), "--help"],
                                env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("verify", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
