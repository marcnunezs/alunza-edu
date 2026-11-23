import hashlib
import json
import tempfile
import time
import unittest
import uuid
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

import launch


def row(position, ok=True):
    return {
        "group": "two-case-first" if not position else "two-case-series", "index": max(1, position),
        "concurrency": 1, "caseCount": 2, "mode": "SUBMIT", "ok": ok,
        "cleanupVerified": True, "auditAbsent": True, "executeMs": 400 + position,
        "diagnosis": "SUCCESS" if ok else "TIMEOUT", "reason": "COMPLETED" if ok else "EXECUTION_DEADLINE",
        "caseTimings": [{"ordinal": i, "visibility": vis, "attempted": True, "createMs": i,
                         "created": True, "startMs": (i * 100) + position, "started": True}
                        for i, vis in enumerate(("visible", "hidden"), 1)],
    }


class TestNativeLauncher(unittest.TestCase):
    def setUp(self):
        self.id = str(uuid.uuid4())
        self.receipt = launch.Receipt(self.id, False)
        self.ready = {"bootId": self.id, "guest": "qemu", "image": launch.CAPSULE}
        self.begin = {"bootId": self.id, "guest": "qemu", "boot": "preseeded-submit", "twoCaseSubmit": 50}

    def emit(self, tag, data, elapsed=400):
        return self.receipt.observe(tag + " " + json.dumps(data), elapsed)

    def test_ready_correlates_and_precedes_all_samples(self):
        with self.assertRaises(launch.Rejected):
            self.emit("LATENCY_SAMPLE", row(0))
        with self.assertRaises(launch.Rejected):
            self.emit("LATENCY_READY", dict(self.ready, bootId=str(uuid.uuid4())))
        self.emit("LATENCY_READY", self.ready, 732)
        with self.assertRaises(launch.Rejected):
            self.emit("LATENCY_READY", self.ready)
        self.emit("LATENCY_BEGIN", self.begin)
        with self.assertRaises(launch.Rejected):
            self.emit("LATENCY_SAMPLE", row(1))
        with self.assertRaises(launch.Rejected):
            self.emit("LATENCY_SAMPLE", dict(row(0), cleanupVerified=False))

    def test_full_series_preserves_failures_and_case_clock(self):
        self.emit("LATENCY_READY", self.ready, 732)
        self.emit("LATENCY_BEGIN", self.begin)
        for i in range(51):
            sample = row(i, i != 4)
            if i == 4:
                sample["caseTimings"][1].update(attempted=False, created=False, createMs=None, startMs=None, started=False)
            self.emit("LATENCY_SAMPLE", sample)
        ending = {"boot": "preseeded-submit", "attempts": 51, "errors": 1, "finalContainers": 0}
        with self.assertRaises(launch.Rejected):
            self.emit("LATENCY_END", dict(ending, errors=0))
        self.emit("LATENCY_END", ending)
        self.receipt.observe("GUEST_CLEAN containers=0", 3000)
        self.receipt.observe("GUEST_FINISH 1", 4000)
        report = self.receipt.result()
        self.assertEqual(report["readyFromLaunchMs"], 732)
        self.assertEqual(report["allErrors"], 1)
        visible, hidden = report["warmSubmit"]["capsules"]
        self.assertEqual((visible["startMs"]["n"], visible["startMs"]["p95Ms"]), (50, 148))
        self.assertEqual((hidden["startMs"]["n"], hidden["missingStarts"], hidden["startMs"]["p95Ms"]), (49, 1, 248))

    def test_seed_has_to_be_unique_and_shutdown_clean(self):
        receipt = launch.Receipt(self.id, True)
        with self.assertRaises(launch.Rejected):
            receipt.observe("GUEST_CLEAN containers=0", 4)
        receipt.observe("NATIVE_SEEDED " + self.id, 5)
        with self.assertRaises(launch.Rejected):
            receipt.observe("NATIVE_SEEDED " + self.id, 5)
        receipt.observe("GUEST_CLEAN containers=0", 8)
        with self.assertRaises(launch.Rejected):
            receipt.result()
        receipt.observe("GUEST_FINISH 0", 9)
        self.assertTrue(receipt.result()["zeroContainers"])

    def test_qemu_uses_only_kvm_and_two_nvme_namespaces(self):
        args = launch.vm_args(Path("/kit"), self.id, True)
        self.assertEqual(args[args.index("-accel") + 1], "kvm")
        self.assertEqual(args[args.index("-nic") + 1], "none")
        self.assertIn("-nodefaults", args)
        self.assertIn("-S", args)
        self.assertIn("alunza.seed=1", args[args.index("-append") + 1])
        self.assertIn("alunza.boot_id=" + self.id, args[args.index("-append") + 1])
        self.assertIn("nvme-ns,bus=ctrl,drive=osdisk,nsid=1", args)
        self.assertIn("nvme-ns,bus=ctrl,drive=store,nsid=2", args)
        self.assertNotIn("alunza.seed=1", " ".join(launch.vm_args(Path("/kit"), self.id, False)))

    def test_qmp_requires_enabled_kvm_and_boot_uuid_before_cont(self):
        for modern, accelerator, boot_id, valid in [
            (False, "kvm", self.id, True), (True, "kvm", self.id, True),
            (True, "tcg", self.id, False), (False, "kvm", str(uuid.uuid4()), False),
        ]:
            method = "query-accelerators" if modern else "query-kvm"
            responses = [
                {"QMP": {}}, {"id": "qmp_capabilities", "return": {}},
                {"id": "query-commands", "return": [{"name": method}]}, {"event": "RESUME"},
                {"id": method, "return": {"enabled": accelerator} if modern else {"enabled": True, "present": True}},
                {"id": "query-uuid", "return": {"UUID": boot_id}},
                {"id": "query-status", "return": {"running": False}}, {"id": "cont", "return": {}},
            ]
            lines = BytesIO(b"".join(json.dumps(value).encode() + b"\n" for value in responses))
            with self.subTest(modern=modern, accelerator=accelerator, matches=boot_id == self.id):
                with patch("launch.socket.AF_UNIX", 1, create=True), patch("launch.socket.socket") as socket_mock:
                    client = socket_mock.return_value.__enter__.return_value
                    client.makefile.return_value = lines
                    proc = MagicMock()
                    proc.poll.return_value = None
                    if valid:
                        result = launch.confirm_qmp(Path("/tmp"), proc, self.id, time.monotonic() + 2)
                        self.assertEqual(result["verifiedWith"], method)
                    else:
                        with self.assertRaises(launch.Rejected):
                            launch.confirm_qmp(Path("/tmp"), proc, self.id, time.monotonic() + 2)
                        self.assertFalse(any(b'"execute": "cont"' in call.args[0] for call in client.sendall.call_args_list))

    def test_manifest_requires_pinned_bytes_for_all_three_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            kit = Path(tmp)
            files = {}
            for name in launch.IMAGES:
                (kit / name).write_bytes(b"fixed")
                files[name] = {"sha256": hashlib.sha256(b"fixed").hexdigest(), "bytes": 5}
            manifest = kit / "guest-manifest.json"
            manifest.write_text(json.dumps({"schema": 1, "files": files, "runnerBundleSha256": launch.BUNDLE,
                                            "capsuleConfigDigest": launch.CAPSULE}))
            expected = launch.digest(manifest)
            self.assertEqual(launch.verified_manifest(kit, expected)["files"], files)
            with self.assertRaises(launch.Rejected):
                launch.verified_manifest(kit, "0" * 64)
            (kit / "kernel").write_bytes(b"other")
            with self.assertRaises(launch.Rejected):
                launch.verified_manifest(kit, expected)

    def test_preflight_rejects_wsl_before_any_vm_or_device_access(self):
        with patch("launch.platform.system", return_value="Linux"), patch("launch.platform.machine", return_value="x86_64"), \
                patch("launch.platform.release", return_value="6.1-microsoft-standard-WSL2"), patch("launch.subprocess.run") as proc:
            with self.assertRaisesRegex(launch.Rejected, "WSL"):
                launch.host()
            proc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
