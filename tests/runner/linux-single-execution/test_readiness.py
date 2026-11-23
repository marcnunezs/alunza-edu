"""Offline readiness checks. No real device, VM, daemon or host command is used."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("physical_readiness", Path(__file__).with_name("readiness.py"))
readiness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(readiness)


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.files = {"/proc/cpuinfo": "flags : fpu vmx sse\nflags : fpu vmx sse\n",
                      "/sys/class/dmi/id/sys_vendor": "Physical manufacturer",
                      "/sys/class/dmi/id/product_name": "Physical model"}
        self.missing_tools = set()
        self.virt = (1, "none\n")
        self.stack.enter_context(patch.object(readiness.platform, "system", return_value="Linux"))
        self.stack.enter_context(patch.object(readiness.platform, "machine", return_value="x86_64"))
        self.stack.enter_context(patch.object(readiness.platform, "release", return_value="6.8.0-generic"))
        self.stack.enter_context(patch.object(readiness.sys, "platform", "linux"))
        self.read = self.stack.enter_context(patch.object(readiness, "read_text", side_effect=self.read_file))
        self.device = self.stack.enter_context(patch.object(readiness, "device_info", return_value={
            "characterDevice": True, "readAccess": True, "writeAccess": True}))
        self.api = self.stack.enter_context(patch.object(readiness, "kvm_api", return_value=12))
        self.commands = self.stack.enter_context(patch.object(readiness, "run_command", side_effect=self.command))
        self.stack.enter_context(patch.object(readiness.shutil, "which", side_effect=lambda name: None if name in self.missing_tools else "/usr/bin/" + name))
        self.authority = self.stack.enter_context(patch.object(readiness, "authoritative_host", return_value={"kvmApiVersion": 12}))
        self.stack.enter_context(patch.object(readiness, "resources", return_value={"minimumsInvented": False}))

    def read_file(self, path):
        value = self.files.get(str(path))
        if isinstance(value, Exception):
            raise value
        if value is None:
            raise FileNotFoundError()
        return value

    def command(self, args):
        if args == ["systemd-detect-virt"]:
            return subprocess.CompletedProcess(args, *self.virt, stderr="")
        if args in (["/usr/bin/qemu-system-x86_64", "--version"], ["/usr/bin/qemu-img", "--version"]):
            return subprocess.CompletedProcess(args, 0, "QEMU version synthetic-test\n", "")
        if args == ["/usr/bin/debugfs", "-V"]:
            return subprocess.CompletedProcess(args, 0, "", "debugfs synthetic-test\n")
        self.fail("Unexpected or potentially mutating command: " + repr(args))

    def check(self, report, identifier):
        return next(row for row in report["checks"] if row["id"] == identifier)

    def test_bare_metal_observations_need_authority_and_debugfs_is_prepare_only(self):
        self.missing_tools.add("debugfs")
        report = readiness.inspect_host()
        self.assertTrue(report["hostEligible"])
        self.assertFalse(report["vmStarted"] or report["prepareToolsAvailable"])
        self.assertEqual(self.check(report, "debugfs")["requiredFor"], "prepare")
        self.assertEqual(self.authority.call_count, 1)
        self.authority.side_effect = ValueError("authority refuses")
        refused = readiness.inspect_host()
        self.assertFalse(refused["hostEligible"])
        self.assertEqual(self.check(refused, "launch-host-authority")["status"], "unknown")

    def test_windows_reports_every_check_without_linux_commands_or_device_access(self):
        with patch.object(readiness.platform, "system", return_value="Windows"), patch.object(readiness.sys, "platform", "win32"):
            self.authority.side_effect = ValueError("LINUX_PHYSICAL_KVM_REQUIRED")
            report = readiness.inspect_host()
        self.assertFalse(report["hostEligible"])
        self.assertEqual(len(report["checks"]), 11)
        self.assertEqual(self.check(report, "platform")["status"], "fail")
        self.commands.assert_not_called()
        self.device.assert_not_called()
        self.api.assert_not_called()
        self.read.assert_not_called()

    def test_wsl_collects_missing_tools_and_dmi_without_claiming_physical_readiness(self):
        self.virt = (0, "wsl\n")
        self.files["/sys/class/dmi/id/sys_vendor"] = FileNotFoundError()
        self.missing_tools.update(("qemu-system-x86_64", "qemu-img"))
        self.device.side_effect = FileNotFoundError()
        self.authority.side_effect = ValueError("WSL host rejected")
        with patch.object(readiness.platform, "release", return_value="6.18.58.1-microsoft-standard-WSL2"):
            report = readiness.inspect_host()
        self.assertFalse(report["hostEligible"])
        self.assertTrue(report["prepareToolsAvailable"])
        self.assertEqual(self.check(report, "kernel-native")["status"], "fail")
        self.assertEqual(self.check(report, "dmi")["status"], "unknown")
        self.assertEqual(self.check(report, "qemu-img")["status"], "fail")
        self.api.assert_not_called()

    def test_partial_or_failed_observations_cannot_pass_even_with_authority_result(self):
        self.files["/proc/cpuinfo"] = "processor : 0\n"
        self.files["/sys/class/dmi/id/product_name"] = PermissionError()
        self.commands.side_effect = subprocess.TimeoutExpired("version-check", 5)
        self.api.return_value = 11
        report = readiness.inspect_host()
        self.assertFalse(report["hostEligible"])
        for identifier in ("cpu-virtualization", "dmi", "virtualization", "qemu-img", "debugfs"):
            self.assertEqual(self.check(report, identifier)["status"], "unknown")
        self.assertEqual(self.check(report, "kvm-api")["status"], "fail")
        self.assertEqual(self.check(report, "launch-host-authority")["status"], "pass")

    def test_nested_cpu_and_dmi_are_not_accepted_despite_available_kvm(self):
        self.virt = (0, "kvm\n")
        self.files["/proc/cpuinfo"] = "flags : vmx hypervisor\n"
        self.files["/sys/class/dmi/id/product_name"] = "QEMU"
        self.authority.side_effect = ValueError("nested host")
        report = readiness.inspect_host()
        for identifier in ("virtualization", "cpu-virtualization", "dmi"):
            self.assertEqual(self.check(report, identifier)["status"], "fail")
        self.assertFalse(report["hostEligible"])

    def test_wrong_device_or_missing_access_never_queries_kvm(self):
        for changed in ("characterDevice", "readAccess", "writeAccess"):
            self.device.return_value = {name: name != changed for name in ("characterDevice", "readAccess", "writeAccess")}
            report = readiness.inspect_host()
            self.assertFalse(report["hostEligible"])
            self.assertEqual(self.check(report, "kvm-device")["status"], "fail")
            self.assertEqual(self.check(report, "kvm-api")["status"], "unknown")
        self.api.assert_not_called()

    def test_inventory_exposes_no_raw_dmi_or_hostname_and_runs_only_version_queries(self):
        self.files["/sys/class/dmi/id/product_name"] = "PRIVATE_MODEL_VALUE"
        report = readiness.inspect_host()
        self.assertNotIn("PRIVATE_MODEL_VALUE", json.dumps(report))
        self.assertNotIn("hostname", json.dumps(report).lower())
        self.assertEqual([call.args[0] for call in self.commands.call_args_list], [
            ["systemd-detect-virt"], ["/usr/bin/qemu-system-x86_64", "--version"],
            ["/usr/bin/qemu-img", "--version"], ["/usr/bin/debugfs", "-V"]])
        self.assertEqual(set(call.args[0] for call in self.read.call_args_list), set(self.files))

    def test_exit_code_two_for_incomplete_and_zero_only_for_eligible_without_vm(self):
        for allowed in (True, False):
            if not allowed:
                self.authority.side_effect = ValueError("rejected")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                status = readiness.main(["host"])
            self.assertEqual(status, 0 if allowed else 2)
            self.assertFalse(json.loads(output.getvalue())["vmStarted"])


class PrimitiveTests(unittest.TestCase):
    def test_device_query_uses_only_get_api_version_and_never_create_vm(self):
        fcntl = MagicMock()
        fcntl.ioctl.return_value = 12
        device = MagicMock()
        device.__enter__.return_value.fileno.return_value = 42
        with patch.dict(sys.modules, {"fcntl": fcntl}), patch("builtins.open", return_value=device) as opened:
            self.assertEqual(readiness.kvm_api(), 12)
        opened.assert_called_once_with("/dev/kvm", "rb+", buffering=0)
        fcntl.ioctl.assert_called_once_with(42, 0xAE00, 0)

    def test_version_command_has_timeout_no_shell_and_no_input(self):
        with patch.object(readiness.subprocess, "run") as command:
            readiness.run_command(["qemu-img", "--version"])
        command.assert_called_once_with(["qemu-img", "--version"], capture_output=True, text=True, timeout=5, check=False)


if __name__ == "__main__":
    unittest.main()
