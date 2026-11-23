"""Offline preparation and opt-in local KVM: one fresh guest, one trusted execution."""

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
import platform
import re
import selectors
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from pathlib import Path

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ARTIFACTS = ("kernel", "root.img", "docker-store.img")
TTL = 60
OPERATION = 30
CLEANUP = 40
MAX_FRAME = 65536
RUN_STARTED = False
LIMITS = {"vcpus": 1, "envelopeMemoryBytes": 2147483648, "studentMemoryBytes": 134217728,
          "swapBytes": 0, "runtimeMs": 3000, "outputBytes": 65536}
COST_PHASES = ("entry", "importsReady", "identityChecked", "inputRead", "wasmReady", "runtimeReady",
               "contextReady", "trustedSetupReady", "studentCompiled", "moduleEvaluated", "solveReturned",
               "serialized", "disposed", "workerExit")
ADVERSARIAL = ("qjs-loop", "qjs-cumulative-time", "qjs-heap-memory", "qjs-buffer-memory",
               "output-aggregate-below", "output-aggregate-at", "output-aggregate-over",
               "qjs-host-globals", "qjs-import-denied", "qjs-stdout-forgery", "qjs-channel-forgery",
               "qjs-envelope-forgery", "qjs-state-isolation", "hidden-projection", "capsule-identity",
               "capsule-permissions", "capsule-network", "capsule-processes", "capsule-memory", "capsule-descendant-memory")


class Rejected(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise Rejected(code)


def sha(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def hash_value(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def regular(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1,
            "REGULAR_FILE_REQUIRED")
    return path


def safe_relative(value):
    return (isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_@./-]+", value) is not None
            and all(part not in ("", ".", "..") for part in value.split("/")))


def write_json(path, data):
    with path.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(data, output, sort_keys=True, indent=2)
        output.write("\n")


def legacy():
    spec = importlib.util.spec_from_file_location("alunza_native_preflight", HERE.parent / "linux-native-kvm/launch.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def host():
    require(sys.platform == "linux" and platform.machine() == "x86_64", "LINUX_PHYSICAL_KVM_REQUIRED")
    # Reuse physical-host/KVM observations, never the old workload or fixed hashes.
    return legacy().host()


def candidate(source):
    code = "import {readCoverageCandidate} from './scripts/quality-coverage.mjs'; console.log(JSON.stringify(await readCoverageCandidate()));"
    data = json.loads(subprocess.run(["node", "--input-type=module", "-e", code], cwd=source,
                                    check=True, text=True, capture_output=True, timeout=60).stdout)
    require(hash_value(data.get("sourceDigest")), "SOURCE_IDENTITY_MISSING")
    return {"sourceDigest": data["sourceDigest"], "sourceCommit": data["commit"]}


def build_bundle(source, output):
    source = source.resolve(strict=True)
    require((source / "scripts/quality-coverage.mjs").is_file(), "SOURCE_CHECKOUT_REQUIRED")
    before = candidate(source)
    subprocess.run(["node", "node_modules/typescript/bin/tsc", "--project", "packages/runner/tsconfig.json"],
                   cwd=source, check=True, timeout=120, capture_output=True)
    require(candidate(source) == before, "SOURCE_CHANGED_DURING_BUILD")
    names = {"packages/runner/package.json"}
    names.update(path.relative_to(source).as_posix() for path in (source / "packages/runner/dist").glob("*.js"))
    names.update(path.relative_to(source).as_posix() for path in (source / "infra/runner").glob("*.mjs"))
    # Only zod is imported by the local cold path. Vercel SDK is dynamically loaded
    # only by the remote adapter, which this guest never selects.
    names.update(path.relative_to(source).as_posix() for path in (source / "node_modules/zod").rglob("*")
                 if path.is_file() and path.suffix in (".js", ".cjs", ".mjs", ".json"))
    require("packages/runner/dist/index.js" in names and "node_modules/zod/package.json" in names,
            "BUNDLE_DEPENDENCIES_MISSING")
    inventory = []
    for name in sorted(names):
        path = regular(source / name)
        require(safe_relative(name) and path.stat().st_size < 20 * 1024 * 1024, "BUNDLE_ENTRY_REJECTED")
        inventory.append({"path": name, "sha256": sha(path), "bytes": path.stat().st_size})
    require(candidate(source) == before, "SOURCE_CHANGED_DURING_BUNDLE")
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    node_version = subprocess.run(["node", "--version"], cwd=source, check=True, text=True, capture_output=True, timeout=5).stdout.strip()
    package = json.loads((source / "package.json").read_text())
    require(node_version == "v" + package["engines"]["node"], "PINNED_NODE_REQUIRED")
    manifest = {"schemaVersion": 1, **before, "sourceIdentityMode": "quality-coverage-v1",
                "scope": "LOCAL_DOCKER_COLD_ONLY", "lockfileSha256": sha(source / "package-lock.json"),
                "runtime": {"node": node_version, "packageManager": package["packageManager"]}, "inventory": inventory}
    write_json(output / "runner-bundle.json", manifest)
    with (output / "runner.tar.gz").open("xb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode="w|") as archive:
                for entry in inventory:
                    info = tarfile.TarInfo(entry["path"])
                    info.size, info.mode, info.mtime = entry["bytes"], 0o644, 0
                    with (source / entry["path"]).open("rb") as data:
                        archive.addfile(info, data)
    verify_bundle(output)
    require(candidate(source) == before, "SOURCE_CHANGED_DURING_ARCHIVE")
    return {"status": "bundle-prepared-not-executed", **before,
            "bundleManifestSha256": sha(output / "runner-bundle.json"),
            "bundleSha256": sha(output / "runner.tar.gz"), "files": len(inventory)}


def verify_bundle(directory):
    manifest = json.loads(regular(directory / "runner-bundle.json").read_text())
    require(manifest.get("schemaVersion") == 1 and hash_value(manifest.get("sourceDigest"))
            and manifest.get("scope") == "LOCAL_DOCKER_COLD_ONLY"
            and manifest.get("sourceIdentityMode") == "quality-coverage-v1"
            and hash_value(manifest.get("lockfileSha256"))
            and isinstance(manifest.get("runtime"), dict)
            and re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", manifest["runtime"].get("node", ""))
            and re.fullmatch(r"npm@[0-9]+\.[0-9]+\.[0-9]+", manifest["runtime"].get("packageManager", "")), "INVALID_BUNDLE_MANIFEST")
    inventory = manifest.get("inventory")
    require(isinstance(inventory, list) and 0 < len(inventory) < 10000, "INVALID_BUNDLE_INVENTORY")
    expected = {}
    for entry in inventory:
        require(safe_relative(entry.get("path")) and hash_value(entry.get("sha256"))
                and type(entry.get("bytes")) is int and 0 <= entry["bytes"] < 20 * 1024 * 1024,
                "INVALID_BUNDLE_ENTRY")
        require(entry["path"].lower() not in expected, "DUPLICATE_BUNDLE_ENTRY")
        expected[entry["path"].lower()] = entry
    seen = set()
    with tarfile.open(regular(directory / "runner.tar.gz"), "r:gz") as archive:
        for member in archive:
            require(member.isfile() and safe_relative(member.name) and member.name.lower() in expected
                    and member.name.lower() not in seen, "UNSAFE_TAR_ENTRY")
            entry = expected[member.name.lower()]
            require(member.name == entry["path"] and member.size == entry["bytes"], "BUNDLE_SIZE_MISMATCH")
            require(hashlib.sha256(archive.extractfile(member).read()).hexdigest() == entry["sha256"],
                    "BUNDLE_HASH_MISMATCH")
            seen.add(member.name.lower())
    require(seen == set(expected), "BUNDLE_INCOMPLETE")
    return manifest


def validate_runtime(value):
    require(isinstance(value, dict) and set(value) == {"runtime", "runtimeName", "runtimeVersion", "runtimeSha256", "runtimePath", "strategy"}, "RUNTIME_FIELDS")
    require(value["runtime"] in ("runc", "crun") and value["runtimeVersion"] == {"runc": "1.3.4", "crun": "1.31"}[value["runtime"]]
            and hash_value(value["runtimeSha256"]) and value["strategy"] == "cold"
            and re.fullmatch(r"alunza-[a-z0-9-]{1,40}", value["runtimeName"])
            and re.fullmatch(r"/[A-Za-z0-9_./-]+", value["runtimePath"])
            and ".." not in value["runtimePath"].split("/"), "RUNTIME_REJECTED")


def prepare(artifacts_file, bundle, output):
    artifacts = json.loads(regular(artifacts_file).read_text())
    require(artifacts.get("schemaVersion") == 1 and artifacts.get("virginBase") is True,
            "VIRGIN_BASE_DECLARATION_REQUIRED")
    validate_runtime(artifacts.get("runtime"))
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", artifacts.get("capsuleImageId", "")), "IMAGE_ID_REQUIRED")
    require(artifacts.get("nodePath") in ("/usr/bin/node", "/usr/local/bin/node"), "NODE_PATH_REJECTED")
    require(set(artifacts.get("files", {})) == set(ARTIFACTS), "ARTIFACT_SET_REQUIRED")
    for name, entry in artifacts["files"].items():
        require(hash_value(entry.get("sha256")) and type(entry.get("bytes")) is int and entry["bytes"] > 0,
                "ARTIFACT_HASH_REQUIRED")
        path = regular(Path(entry["path"]).resolve(strict=True))
        require(path.stat().st_size == entry["bytes"] and sha(path) == entry["sha256"], "INPUT_ARTIFACT_MISMATCH")
    manifest = verify_bundle(bundle)
    require(hash_value(artifacts.get("bundleManifestSha256")) and hash_value(artifacts.get("bundleSha256"))
            and sha(bundle / "runner-bundle.json") == artifacts["bundleManifestSha256"]
            and sha(bundle / "runner.tar.gz") == artifacts["bundleSha256"], "SUPPLIED_BUNDLE_IDENTITY_MISMATCH")
    require(shutil.which("debugfs"), "DEBUGFS_REQUIRED_FOR_OFFLINE_IMAGE_PREPARATION")
    output.mkdir(mode=0o700, exist_ok=False)
    for name, entry in artifacts["files"].items():
        shutil.copyfile(entry["path"], output / name)
    staging = output / "install"
    staging.mkdir(mode=0o700)
    shutil.copyfile(HERE / "guest.cjs", staging / "guest.cjs")
    for name in ("adversarial.cjs", "adversarial-guest.cjs"):
        shutil.copyfile(HERE / name, staging / name)
    shutil.copyfile(HERE.parent / "fixtures.mjs", staging / "fixtures.mjs")
    shutil.copyfile(bundle / "runner.tar.gz", staging / "runner.tar.gz")
    shutil.copyfile(bundle / "runner-bundle.json", staging / "runner-bundle.json")
    (staging / "alunzasingleexecutor.slice").write_text("[Unit]\nDescription=Private local runner envelope\n[Slice]\nMemoryMax=2147483648\nMemorySwapMax=0\nCPUQuota=100%\n")
    (staging / "alunza-single.service").write_text(
        "[Unit]\nAfter=basic.target\nRequires=alunzasingleexecutor.slice\n[Service]\nType=oneshot\n"
        "Slice=alunzasingleexecutor.slice\nDelegate=yes\nExecStart=" + artifacts["nodePath"] +
        " /opt/alunza-single/guest.cjs\nStandardOutput=tty\nTTYPath=/dev/ttyS0\nStandardError=null\nTimeoutStartSec=40\n")
    (staging / "alunza-single.target").write_text("[Unit]\nRequires=basic.target alunza-single.service\nAfter=basic.target\nAllowIsolate=yes\n")
    destinations = {name: "/opt/alunza-single/" + name for name in ("guest.cjs", "runner.tar.gz", "runner-bundle.json")}
    destinations.update({name: "/opt/alunza-single/" + name for name in ("adversarial.cjs", "adversarial-guest.cjs")})
    destinations["fixtures.mjs"] = "/opt/fixtures.mjs"
    destinations.update({name: "/etc/systemd/system/" + name for name in ("alunzasingleexecutor.slice", "alunza-single.service", "alunza-single.target")})
    commands = ["mkdir /opt/alunza-single"]
    for name, destination in destinations.items():
        commands.extend(["rm " + destination, "write " + name + " " + destination])
    (staging / "install.commands").write_text("\n".join(commands) + "\n")
    subprocess.run(["debugfs", "-w", "-f", "install.commands", str((output / "root.img").resolve())],
                   cwd=staging, capture_output=True, check=True, timeout=120)
    # debugfs may return zero on a failed individual command: verify installed bytes.
    for index, (name, destination) in enumerate(destinations.items()):
        verification = "installed-" + str(index)
        subprocess.run(["debugfs", "-R", "dump " + destination + " " + verification, str((output / "root.img").resolve())],
                       cwd=staging, capture_output=True, check=True, timeout=120)
        require((staging / verification).is_file() and sha(staging / name) == sha(staging / verification), "GUEST_INSTALL_NOT_VERIFIED")
    kit = {"schemaVersion": 2, "scope": "LOCAL_SINGLE_EXECUTION", "sourceDigest": manifest["sourceDigest"],
           "sourceIdentityMode": manifest["sourceIdentityMode"],
           "sourceCommit": manifest["sourceCommit"], "bundleManifestSha256": sha(bundle / "runner-bundle.json"),
           "bundleSha256": sha(bundle / "runner.tar.gz"), "capsuleImageId": artifacts["capsuleImageId"],
           "runtime": artifacts["runtime"], "nodePath": artifacts["nodePath"], "virginBase": "supplied-declaration-not-forensic-proof",
           "baseFiles": {name: {key: entry[key] for key in ("sha256", "bytes")} for name, entry in artifacts["files"].items()},
           "files": {name: {"sha256": sha(output / name), "bytes": (output / name).stat().st_size} for name in ARTIFACTS},
           "guestEntrypointSha256": sha(HERE / "guest.cjs"),
           "guestSupportFiles": {destinations[name]: sha(staging / name) for name in ("adversarial.cjs", "adversarial-guest.cjs", "fixtures.mjs")},
           "execution": "not-run"}
    write_json(output / "guest-manifest.json", kit)
    return {"status": "kit-prepared-not-executed", "manifestSha256": sha(output / "guest-manifest.json"), "sourceDigest": manifest["sourceDigest"]}


def verified_kit(kit, expected):
    require(hash_value(expected) and sha(regular(kit / "guest-manifest.json")) == expected, "KIT_MANIFEST_MISMATCH")
    data = json.loads((kit / "guest-manifest.json").read_text())
    require(data.get("schemaVersion") == 2 and data.get("scope") == "LOCAL_SINGLE_EXECUTION"
            and hash_value(data.get("sourceDigest")) and hash_value(data.get("bundleManifestSha256"))
            and hash_value(data.get("bundleSha256")) and set(data.get("files", {})) == set(ARTIFACTS), "KIT_CONTRACT_REJECTED")
    validate_runtime(data.get("runtime"))
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", data.get("capsuleImageId", "")), "IMAGE_ID_REQUIRED")
    for name, entry in data["files"].items():
        path = regular(kit / name)
        require(path.stat().st_size == entry["bytes"] and sha(path) == entry["sha256"], "KIT_FILE_MISMATCH")
    return data


def validate_workload(mode, count, fixture):
    require(mode in ("RUN", "SUBMIT") and type(count) is int and count in ((1, 2, 8) if mode == "RUN" else (2, 8)), "WORKLOAD_REJECTED")
    require(fixture == "sum-fixed-v1" or fixture in ADVERSARIAL, "FIXTURE_REJECTED")
    if fixture != "sum-fixed-v1":
        two_cases = fixture in ("qjs-cumulative-time", "output-aggregate-below", "output-aggregate-at", "output-aggregate-over", "qjs-state-isolation", "hidden-projection")
        require(count == (2 if two_cases else 1) and mode == ("SUBMIT" if fixture == "hidden-projection" else "RUN"), "ADVERSARIAL_WORKLOAD_REJECTED")


def request(kit, mode, count, boot_id, created_epoch_ms, fixture="sum-fixed-v1"):
    validate_workload(mode, count, fixture)
    return {"schemaVersion": 1, "bootId": boot_id, "executionId": str(uuid.uuid4()), "mode": mode,
            "caseCount": count, "fixture": fixture, "maxAdmissions": 1,
            "createdAtEpochMs": created_epoch_ms, "normalDeadlineEpochMs": created_epoch_ms + OPERATION * 1000,
            "cleanupDeadlineEpochMs": created_epoch_ms + CLEANUP * 1000, "ttlMs": TTL * 1000,
            **{key: kit[key] for key in ("sourceDigest", "bundleManifestSha256", "bundleSha256", "capsuleImageId", "runtime")}}


def vm_args(kit, boot_id):
    # One disk per driver family avoids asynchronous NVMe namespace-name order.
    # Omit unused SATA/PS2 hardware; quiet retains ttyS0 receipts and boot errors.
    return ["qemu-system-x86_64", "-machine", "q35,sata=off,i8042=off", "-accel", "kvm", "-cpu", "host", "-smp", "1", "-m", "2048",
            "-uuid", boot_id, "-smbios", "type=1,manufacturer=QEMU,product=AlunzaSingleExecution",
            "-nodefaults", "-no-user-config", "-nic", "none", "-display", "none", "-monitor", "none", "-no-reboot",
            "-S", "-qmp", "unix:qmp.sock,server=on,wait=off", "-serial", "stdio", "-rtc", "base=utc,clock=host",
            "-kernel", str(kit / "kernel"), "-append", "root=/dev/vda rw rootwait rootfstype=ext4 init=/lib/systemd/systemd systemd.unit=alunza-single.target console=ttyS0,115200 panic=1 quiet systemd.show_status=error",
            "-fw_cfg", "name=opt/alunza/request,file=request.json",
            "-drive", "if=none,id=osdisk,file=os.qcow2,format=qcow2", "-drive", "if=none,id=store,file=store.qcow2,format=qcow2",
            "-device", "virtio-blk-pci,drive=osdisk,serial=ALUNZAROOT", "-device", "nvme,id=ctrl,serial=ALUNZASINGLE",
            "-device", "nvme-ns,bus=ctrl,drive=store,nsid=1"]


def confirm_qmp(work, proc, boot_id, deadline):
    # Same paused-start pattern as the native kit, adding outer resource proof.
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        while True:
            require(proc.poll() is None and time.monotonic() < deadline, "QMP_UNAVAILABLE")
            try:
                client.connect(str(work / "qmp.sock"))
                break
            except (FileNotFoundError, ConnectionRefusedError):
                time.sleep(0.02)
        with client.makefile("rb") as lines:
            def receive():
                remaining = deadline - time.monotonic()
                require(remaining > 0, "QMP_DEADLINE")
                client.settimeout(remaining)
                line = lines.readline(131072)
                require(line.endswith(b"\n"), "QMP_FRAME_REJECTED")
                return json.loads(line)

            def command(name):
                client.sendall((json.dumps({"execute": name, "id": name}) + "\r\n").encode())
                while True:
                    answer = receive()
                    if answer.get("id") == name:
                        require("return" in answer, "QMP_COMMAND_REJECTED")
                        return answer["return"]

            require("QMP" in receive(), "QMP_GREETING_REJECTED")
            command("qmp_capabilities")
            kvm = command("query-kvm")
            require(kvm.get("enabled") is True and kvm.get("present") is True, "KVM_NOT_ENABLED")
            require(command("query-uuid")["UUID"].lower() == boot_id, "QMP_UUID_MISMATCH")
            require(command("query-status")["running"] is False, "GUEST_ALREADY_RUNNING")
            require(len(command("query-cpus-fast")) == 1, "GUEST_CPU_MISMATCH")
            memory = command("query-memory-size-summary")
            require(memory.get("base-memory") == 2147483648 and memory.get("plugged-memory", 0) == 0, "GUEST_MEMORY_MISMATCH")
            command("cont")
    return {"enabled": "kvm", "uuid": boot_id, "vcpu": 1, "memoryBytes": 2147483648, "observedBeforeCont": True}


def measured_ms(value):
    return type(value) in (int, float) and 0 <= value <= 60000


def adversarial_contract(profile):
    """Finite host-side contract; no caller-supplied source or dynamic import."""
    require(profile in ADVERSARIAL, "FIXTURE_REJECTED")
    outcomes = {
        "qjs-loop": ("TIMEOUT", "EXECUTION_DEADLINE"),
        "qjs-cumulative-time": ("TIMEOUT", "EXECUTION_DEADLINE"),
        "qjs-heap-memory": ("UNKNOWN", "MEMORY_LIMIT"),
        "qjs-buffer-memory": ("UNKNOWN", "MEMORY_LIMIT"),
        "output-aggregate-over": ("UNKNOWN", "OUTPUT_LIMIT"),
        "qjs-import-denied": ("RUNTIME_ERROR", "STUDENT_EXCEPTION"),
        "qjs-channel-forgery": ("RUNTIME_ERROR", "STUDENT_EXCEPTION"),
        "qjs-stdout-forgery": ("FAILED_TEST", "ASSERTION_FAILED"),
        "qjs-envelope-forgery": ("FAILED_TEST", "ASSERTION_FAILED"),
    }
    native = profile.startswith("capsule-")
    oom = profile in ("capsule-memory", "capsule-descendant-memory")
    count = 2 if profile in ("qjs-cumulative-time", "output-aggregate-below", "output-aggregate-at",
                             "output-aggregate-over", "qjs-state-isolation", "hidden-projection") else 1
    diagnosis, reason = (None, None) if native else outcomes.get(profile, ("SUCCESS", "COMPLETED"))
    return {"id": profile, "kind": "probe" if native else "runner",
            "scope": "CAPSULE_KERNEL" if native else "QUICKJS", "caseCount": count,
            "mode": "SUBMIT" if profile == "hidden-projection" else "RUN",
            "expectedDiagnosis": diagnosis, "expectedReason": reason,
            "expectedNativeOutcome": ("KERNEL_OOM" if oom else profile[len("capsule-"):]) if native else None,
            "limits": {"runtimeMs": 3000, "outputBytes": 65536, "memoryBytes": 134217728, "pids": 32,
                       "envelopeMemoryBytes": 2147483648, "vcpus": 1, "ttlMs": 60000},
            "physicalLastInstructionClaim": False, "hostRetirementRequired": True}


def adversarial_checks(profile, timing_complete):
    """Known keys include failure paths; a PASS additionally needs every reached gate."""
    contract = adversarial_contract(profile)
    base = set("CANDIDATE_IDENTITY BEFORE_INPUT_CONTROLS CAPSULE_RETIREMENT_UNCONFIRMED".split())
    if contract["kind"] == "runner":
        required = base | set(("RESULT_REQUIRED UNEXPECTED_OUTCOME INFRASTRUCTURE_FAILED RESULT_IMAGE_MISMATCH "
                               "RUNNER_CLEANUP_UNCONFIRMED OUTPUT_ACCOUNTING_INVALID OUTPUT_TRUNCATION_INVALID "
                               "RUNTIME_INVALID REPORTED_RUNTIME_EXCEEDS_3000 TIMING_OR_DISPATCH_COUNT "
                               "ACCUMULATED_TIME_BUDGET ACCUMULATED_OUTPUT_BUDGET PACKET_CONTROLS").split())
        if contract["expectedDiagnosis"] == "SUCCESS":
            required.add("SUCCESS_AT_EXHAUSTED_BUDGET")
        if profile.startswith("output-aggregate-"):
            required.update(("OUTPUT_BYTE_SUM", "EXACT_OUTPUT_BOUNDARY"))
        if profile in ("qjs-loop", "qjs-cumulative-time"):
            required.add("WATCHDOG_KILL_NOT_OBSERVED")
        if profile == "hidden-projection":
            required.add("HIDDEN_PROJECTION_LEAK_OR_MISSING")
        known = required | {"CHARGED_TIME_SUM", "TIMING_INCOMPLETE", "MALFORMED_RUNNER_OBSERVATION"}
        required.add("CHARGED_TIME_SUM" if timing_complete else "TIMING_INCOMPLETE")
    else:
        required = base | set(("RESPONSE_REQUIRED PROBE_IDENTITY PROBE_CLEANUP_UNCONFIRMED "
                               "PROBE_CANCELLED_OR_TIMED_OUT PROBE_DISPATCH_LIMITS").split())
        if contract["expectedNativeOutcome"] == "KERNEL_OOM":
            required.add("KERNEL_OOM_NOT_OBSERVED")
            if timing_complete:
                required.add("REPORTED_RUNTIME_EXCEEDS_3000")
            known = required | {"REPORTED_RUNTIME_EXCEEDS_3000", "PACKET_CONTROLS", "MALFORMED_PROBE_OBSERVATION"}
        else:
            required.update(("REPORTED_RUNTIME_EXCEEDS_3000", "PROBE_DID_NOT_COMPLETE", "PROBE_TIMING_INCOMPLETE",
                             "PACKET_CONTROLS", "UNEXPECTED_PROBE_OUTPUT", "NATIVE_POLICY_NOT_DEMONSTRATED"))
            known = required | {"MALFORMED_PROBE_OBSERVATION"}
    return known, required


def project_adversarial(value, profile, passed):
    """Project every level explicitly; failed partial observations remain failed and partial."""
    code = "ADVERSARIAL_ASSESSMENT_REJECTED"
    contract = adversarial_contract(profile)

    def boolean(item):
        require(type(item) is bool, code)
        return item

    def enum(*allowed):
        def project(item):
            require(any(type(item) is type(option) and item == option for option in allowed), code)
            return item
        return project

    def number(item):
        require(item is None or measured_ms(item), code)
        return item

    def count(item):
        require(item is None or (type(item) is int and 0 <= item <= 9007199254740991), code)
        return item

    def fields(item, schema):
        require(isinstance(item, dict), code)
        return {key: project(item[key]) for key, project in schema.items() if key in item}

    def fixed(item, expected):
        require(isinstance(item, dict) and set(expected) <= set(item), code)
        result = {}
        for key, expected_value in expected.items():
            result[key] = fixed(item[key], expected_value) if isinstance(expected_value, dict) else enum(expected_value)(item[key])
        return result

    watch_fields = {key: number for key in (
        "budgetMs", "deadlineMs", "launchRequestedMs", "spawnObservedMs", "timerArmedMs", "timerDelayMs",
        "watchdogFiredMs", "watchdogLatenessMs", "firstKillAttemptMs", "lastKillAttemptMs",
        "firstKillCallSucceededMs", "lastKillCallSucceededMs", "exitObservedMs", "closeObservedMs")}
    watch_fields.update({"version": enum(1), "clock": enum("PERFORMANCE_NOW"), "origin": enum("BRIDGE_INPUT_PARSED"),
                         "killAttempts": count, "killCallSuccesses": count, "lastGuestInstructionObservedMs": enum(None)})

    def watchdog(item):
        if item is None:
            return None
        require(isinstance(item, dict) and set(watch_fields) <= set(item), code)
        schema = dict(watch_fields)
        if item.get("version") == 2:
            schema.update({"version": enum(2), "retirementReserveMs": number, "stopDeadlineMs": number, "launchSkipped": boolean})
        result = fields(item, schema)
        if result["version"] == 2:
            require(type(result.get("budgetMs")) in (int, float)
                    and 0 <= result["budgetMs"] <= 3000
                    and type(result.get("retirementReserveMs")) in (int, float)
                    and result["retirementReserveMs"] == min(50, result["budgetMs"])
                    and result.get("stopDeadlineMs") == result["budgetMs"] - result["retirementReserveMs"]
                    and type(result.get("launchSkipped")) is bool, code)
        return result

    def timings(items):
        require(isinstance(items, list) and len(items) <= contract["caseCount"], code)
        schema = {key: number for key in ("budgetMs", "supervisorProcessMs", "hostStartAttachMs", "containerWallMs")}
        schema.update({"outputRemaining": count, "watchdog": watchdog})
        return [fields(item, schema) for item in items]

    result_schema = {
        "diagnosis": enum("SUCCESS", "SYNTAX_ERROR", "RUNTIME_ERROR", "FAILED_TEST", "TIMEOUT", "UNKNOWN", "INVALID"),
        "reason": enum("COMPLETED", "STUDENT_SYNTAX", "STUDENT_EXCEPTION", "ASSERTION_FAILED", "EXECUTION_DEADLINE",
                       "MEMORY_LIMIT", "OUTPUT_LIMIT", "RETURN_LIMIT", "PROTOCOL_INVALID", "RUNNER_FAILURE",
                       "PROVIDER_FAILURE", "CAPABILITY_GAP", "CANCELLED", "INVALID"),
        "infrastructure": enum("OK", "FAILED", "INVALID"), "runtimeMs": number, "outputBytes": count,
        "outputTruncated": boolean, "visibleCount": count, "hiddenCount": count,
    }
    native_schema = {key: number for key in ("runtimeMs", "containerWallMs", "hostStartAttachMs")}
    native_schema.update({"oomState": boolean, "oomKillEvents": count})
    native_booleans = {
        "capsule-identity": ("identityGuardPassed",),
        "capsule-permissions": ("parentReadDenied", "bridgeWriteDenied", "environmentAllowlistMatched"),
        "capsule-network": ("loopbackOnly",),
        "capsule-processes": ("childIdentitiesValid",),
    }
    native_schema.update({key: boolean for key in native_booleans.get(profile, ())})
    if profile == "capsule-identity":
        native_schema["guardSource"] = enum("PINNED_WORKER_IDENTITY")
    if profile == "capsule-network":
        native_schema["network"] = lambda item: fields(item, {key: enum("ENETUNREACH", "EHOSTUNREACH", "EACCES", "EPERM", "ECONNREFUSED", "UNCONFIRMED") for key in ("dns", "ipv6", "udp")})
    if profile == "capsule-processes":
        native_schema["processes"] = lambda item: fields(item, {key: count for key in ("attempted", "started", "eagain", "unexpectedErrors", "pidsMax", "pidsCurrent")})
    schema = {
        "schemaVersion": enum(1), "fixture": enum(profile), "profileId": enum(profile), "scope": enum(contract["scope"]),
        "expected": lambda item: fixed(item, contract), "status": enum("PASSED" if passed else "FAILED"), "pass": enum(passed),
        "physicalLastInstructionObserved": enum(False), "hostRetirementRequired": enum(True), "latencySample": enum(False),
        "expectedOutcomeObserved": boolean, "controlsObserved": boolean, "cleanupVerified": boolean, "capsuleCount": count,
        "timingComplete": boolean, "observedStudentRuntimeMs": number,
        "withinReportedTimeLimit": enum(None, True, False), "reportedOverrunMs": number,
    }
    if contract["kind"] == "runner":
        schema.update({"result": lambda item: fields(item, result_schema), "timings": timings})
        if profile in ("qjs-loop", "qjs-cumulative-time"):
            schema.update({"watchdogObserved": boolean, "physicalDeadlineAcceptance": enum("NOT_ESTABLISHED_BY_NOTIFICATION_TIMESTAMPS")})
        if profile == "hidden-projection":
            schema["hiddenProjectionVerified"] = boolean
    else:
        schema["native"] = lambda item: fields(item, native_schema)
        if contract["expectedNativeOutcome"] == "KERNEL_OOM":
            schema["memoryScope"] = enum("CAPSULE_AND_DESCENDANTS" if profile == "capsule-descendant-memory" else "CAPSULE_NATIVE_ALLOCATIONS")
    projected = fields(value, schema)
    require({"schemaVersion", "profileId", "pass", "status", "physicalLastInstructionObserved", "hostRetirementRequired", "latencySample"} <= set(projected), code)
    known, mandatory = adversarial_checks(profile, projected.get("timingComplete") is True)
    checks, failures = value.get("checks"), value.get("failures")
    require(isinstance(checks, dict) and 0 < len(checks) <= len(known) and set(checks) <= known
            and all(type(item) is bool for item in checks.values())
            and isinstance(failures, list) and all(isinstance(item, str) and item in known for item in failures)
            and len(failures) == len(set(failures)) and set(failures) == {key for key, item in checks.items() if not item}
            and passed == (all(checks.values()) and not failures), "ADVERSARIAL_GATES_REJECTED")
    projected.update(checks=dict(checks), failures=list(failures))
    if passed:
        require(mandatory <= set(checks) and all(projected.get(key) is True for key in ("expectedOutcomeObserved", "controlsObserved", "cleanupVerified"))
                and projected.get("capsuleCount") == contract["caseCount"], "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
        incomplete_allowed = profile in ("qjs-heap-memory", "qjs-buffer-memory", "capsule-memory", "capsule-descendant-memory")
        require(type(projected.get("timingComplete")) is bool and (projected["timingComplete"] or incomplete_allowed), "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
        if contract["kind"] == "runner":
            result = projected.get("result", {})
            require(set(result_schema) <= set(result) and result.get("diagnosis") == contract["expectedDiagnosis"] and result.get("reason") == contract["expectedReason"]
                    and result.get("infrastructure") == "OK" and measured_ms(result.get("runtimeMs")) and result["runtimeMs"] <= 3000
                    and type(result.get("outputBytes")) is int and result["outputBytes"] <= 65536
                    and projected.get("withinReportedTimeLimit") is True and projected.get("reportedOverrunMs") == 0
                    and len(projected.get("timings", [])) == contract["caseCount"], "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
            spent = 0
            for row in projected["timings"]:
                require(set(row) == {"budgetMs", "outputRemaining", "supervisorProcessMs", "hostStartAttachMs", "containerWallMs", "watchdog"}
                        and row["budgetMs"] == 3000 - spent and type(row["outputRemaining"]) is int and row["outputRemaining"] <= 65536,
                        "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
                if projected["timingComplete"]:
                    require(measured_ms(row["supervisorProcessMs"]), "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
                    spent += row["supervisorProcessMs"]
            if projected["timingComplete"]:
                require(spent == result["runtimeMs"] == projected.get("observedStudentRuntimeMs"), "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
            else:
                require(projected.get("observedStudentRuntimeMs") is None, "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
            if contract["expectedDiagnosis"] == "SUCCESS":
                require(result["runtimeMs"] < 3000, "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
            if profile in ("qjs-loop", "qjs-cumulative-time"):
                watch = projected["timings"][-1].get("watchdog")
                require(projected.get("watchdogObserved") is True and isinstance(watch, dict)
                        and type(watch.get("killAttempts")) is int and 0 < watch["killAttempts"] <= 10000
                        and type(watch.get("killCallSuccesses")) is int and 0 < watch["killCallSuccesses"] <= watch["killAttempts"]
                        and measured_ms(watch.get("watchdogFiredMs")) and measured_ms(watch.get("exitObservedMs"))
                        and watch.get("budgetMs") == watch.get("deadlineMs") == projected["timings"][-1]["budgetMs"]
                        and watch.get("closeObservedMs") == projected["timings"][-1]["supervisorProcessMs"], "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
            if profile == "hidden-projection":
                require(projected.get("hiddenProjectionVerified") is True, "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
        else:
            native = projected.get("native", {})
            require(set(native_schema) <= set(native) and all(native.get(key) is True for key in native_booleans.get(profile, ())), "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
            if contract["expectedNativeOutcome"] == "KERNEL_OOM":
                require(native.get("oomState") is True or (type(native.get("oomKillEvents")) is int and native["oomKillEvents"] > 0), "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
            if projected["timingComplete"]:
                require(measured_ms(native.get("runtimeMs")) and native["runtimeMs"] <= 3000
                        and native["runtimeMs"] == projected.get("observedStudentRuntimeMs")
                        and projected.get("withinReportedTimeLimit") is True and projected.get("reportedOverrunMs") == 0, "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
            else:
                require(all(projected.get(key) is None for key in ("observedStudentRuntimeMs", "withinReportedTimeLimit", "reportedOverrunMs"))
                        and native.get("runtimeMs") is None, "ADVERSARIAL_PASS_EVIDENCE_REQUIRED")
    return projected


def project_case_cost(value):
    if value is None:
        return None
    try:
        require(value["version"] == 1 and value["workerClock"] == "PERFORMANCE_NOW"
                and value["workerOrigin"] == "NODE_PERFORMANCE_TIME_ORIGIN"
                and value["bridgeOrigin"] == "BRIDGE_INPUT_PARSED"
                and value["status"] in ("COMPLETE", "PARTIAL", "MISSING", "INVALID"), "PROFILE_INVALID")
        phases = value["phases"]
        require(isinstance(phases, list) and len(phases) <= len(COST_PHASES), "PROFILE_INVALID")
        clean, previous_index, previous_ms = [], -1, -1
        for phase in phases:
            index = COST_PHASES.index(phase["phase"])
            require(index > previous_index and measured_ms(phase["atMs"]) and phase["atMs"] >= previous_ms, "PROFILE_INVALID")
            clean.append({key: phase[key] for key in ("phase", "atMs")})
            previous_index, previous_ms = index, phase["atMs"]
        require(all(measured_ms(value[key]) for key in ("launchRequestedMs", "closeObservedMs"))
                and all(value[key] is None or measured_ms(value[key]) for key in ("receivedFirstMs", "receivedLastMs")), "PROFILE_INVALID")
        require(value["closeObservedMs"] >= value["launchRequestedMs"]
                and (value["receivedFirstMs"] is None) == (value["receivedLastMs"] is None), "PROFILE_INVALID")
        if value["receivedFirstMs"] is not None:
            require(value["launchRequestedMs"] <= value["receivedFirstMs"] <= value["receivedLastMs"] <= value["closeObservedMs"], "PROFILE_INVALID")
        require(not phases or (phases[0]["phase"] == "entry" and value["receivedFirstMs"] is not None), "PROFILE_INVALID")
        last = phases[-1]["phase"] if phases else None
        require((value["status"] != "COMPLETE" or last == "workerExit")
                and (value["status"] != "PARTIAL" or (last is not None and last != "workerExit"))
                and (value["status"] not in ("MISSING", "INVALID") or not phases)
                and (value["status"] != "MISSING" or value["receivedFirstMs"] is None), "PROFILE_INVALID")
        return {**{key: value[key] for key in ("version", "workerClock", "workerOrigin", "bridgeOrigin", "status",
                                             "receivedFirstMs", "receivedLastMs", "launchRequestedMs", "closeObservedMs")}, "phases": clean}
    except (Rejected, KeyError, TypeError, ValueError):
        # Profiling has no authority over the exercise diagnosis or its budget.
        return {"status": "INVALID"}


class Receipt:
    def __init__(self, admission):
        self.admission, self.ready, self.result, self.clean = admission, None, None, False
        self.ready_evidence = None

    def observe(self, line, elapsed_ms):
        if not line.startswith("ALUNZA_SINGLE "):
            return None
        value = json.loads(line[len("ALUNZA_SINGLE "):])
        require(isinstance(value, dict), "RECEIPT_OBJECT_REQUIRED")
        require(value.get("bootId") == self.admission["bootId"] and value.get("executionId") == self.admission["executionId"], "RECEIPT_IDENTITY_MISMATCH")
        event = value.get("event")
        if event == "ready":
            require(self.ready is None and self.result is None and value.get("sourceDigest") == self.admission["sourceDigest"], "READY_REJECTED")
            require(value.get("runtime") == self.admission["runtime"]["runtime"]
                    and value.get("runtimeVersion") == self.admission["runtime"]["runtimeVersion"]
                    and value.get("strategy") == "cold" and value.get("daemonInEnvelope") is True
                    and value.get("supervisorInEnvelope") is True
                    and isinstance(value.get("nodeVersion"), str) and re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", value["nodeVersion"])
                    and isinstance(value.get("runnerVersion"), str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", value["runnerVersion"]), "READY_CONTROLS_REJECTED")
            self.ready = elapsed_ms
            public = {key: value[key] for key in ("event", "sourceDigest", "runtime", "runtimeVersion", "strategy", "runnerVersion", "nodeVersion", "daemonInEnvelope", "supervisorInEnvelope")}
            self.ready_evidence = public
        elif event == "adversarial-result":
            require(self.admission["fixture"] in ADVERSARIAL and self.ready is not None and self.result is None,
                    "ADVERSARIAL_ADMISSION_REQUIRED")
            require(value.get("profile") == self.admission["fixture"] and value.get("admissions") == 1
                    and value.get("caseCount") == self.admission["caseCount"] and value.get("mode") == self.admission["mode"],
                    "ADVERSARIAL_IDENTITY_MISMATCH")
            require(type(value.get("ok")) is bool and measured_ms(value.get("executeMs")), "ADVERSARIAL_GATES_REJECTED")
            assessment = project_adversarial(value.get("assessment"), self.admission["fixture"], value["ok"])
            self.result = {key: value[key] for key in ("event", "admissions", "mode", "caseCount", "profile", "ok", "executeMs")}
            self.result["assessment"] = assessment
            public = self.result
        elif event == "result":
            require(self.admission["fixture"] == "sum-fixed-v1", "EXPECTED_ADVERSARIAL_RECEIPT")
            require(self.ready is not None and self.result is None and value.get("admissions") == 1
                    and value.get("caseCount") == self.admission["caseCount"] and value.get("mode") == self.admission["mode"], "SECOND_OR_INVALID_ADMISSION")
            require(value.get("diagnosis") in ("SUCCESS", "SYNTAX_ERROR", "RUNTIME_ERROR", "FAILED_TEST", "TIMEOUT", "UNKNOWN")
                    and type(value.get("ok")) is bool and type(value.get("cleanupVerified")) is bool, "RESULT_REJECTED")
            require(isinstance(value.get("reason"), str) and re.fullmatch(r"[A-Z_]{1,48}", value["reason"]), "RESULT_REASON_REJECTED")
            for metric in ("runtimeMs", "executeMs"):
                require(measured_ms(value.get(metric)), "RESULT_TIME_REJECTED")
            require(value.get("limits") == LIMITS and all(type(item) is int for item in value["limits"].values())
                    and type(value.get("outputBytes")) is int and 0 <= value["outputBytes"] <= LIMITS["outputBytes"]
                    and type(value.get("outputTruncated")) is bool and value.get("infrastructureStatus") in ("OK", "FAILED")
                    and all(type(value.get(key)) is bool for key in ("controlsObserved", "budgetObserved", "imageMatched"))
                    and type(value.get("casesCompleted")) is int and 0 <= value["casesCompleted"] <= self.admission["caseCount"], "RESULT_LIMITS_REJECTED")
            require(value["budgetObserved"] == (value["runtimeMs"] < LIMITS["runtimeMs"]), "BUDGET_OBSERVATION_MISMATCH")
            timings = value.get("caseTimings")
            require(isinstance(timings, list) and len(timings) <= self.admission["caseCount"], "CASE_TIMINGS_REJECTED")
            clean_timings = []
            for index, row in enumerate(timings):
                require(isinstance(row, dict) and {"ordinal", "hostStartAttachMs", "containerWallMs", "supervisorProcessMs", "budgetMs"} <= set(row)
                        and row.get("ordinal") == index + 1 and measured_ms(row.get("hostStartAttachMs"))
                        and all(row.get(key) is None or measured_ms(row[key]) for key in ("containerWallMs", "supervisorProcessMs"))
                        and measured_ms(row.get("budgetMs")) and row["budgetMs"] <= LIMITS["runtimeMs"], "CASE_TIMING_REJECTED")
                clean_timings.append({**{key: row[key] for key in ("ordinal", "hostStartAttachMs", "containerWallMs", "supervisorProcessMs", "budgetMs")},
                                      "caseCost": project_case_cost(row.get("caseCost"))})
            require(not value["ok"] or (value["diagnosis"] == "SUCCESS" and value["reason"] == "COMPLETED"
                    and value["cleanupVerified"] and value["controlsObserved"] and value["budgetObserved"] and value["imageMatched"]
                    and value["infrastructureStatus"] == "OK" and not value["outputTruncated"]
                    and value["casesCompleted"] == self.admission["caseCount"] and len(timings) == self.admission["caseCount"]), "UNSUPPORTED_SUCCESS_RECEIPT")
            if value["ok"]:
                accumulated_ms = 0
                for row in clean_timings:
                    require(measured_ms(row["supervisorProcessMs"]) and row["budgetMs"] == LIMITS["runtimeMs"] - accumulated_ms,
                            "CASE_BUDGET_RESET_OR_MISMATCH")
                    accumulated_ms += row["supervisorProcessMs"]
                require(accumulated_ms == value["runtimeMs"], "ACCUMULATED_RUNTIME_MISMATCH")
            phases = value.get("phases")
            require(isinstance(phases, list) and len(phases) <= 1000, "PHASES_REJECTED")
            clean_phases = []
            for phase in phases:
                require(isinstance(phase, dict) and isinstance(phase.get("phase"), str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9]{0,63}", phase["phase"])
                        and type(phase.get("durationMs")) in (int, float) and 0 <= phase["durationMs"] <= 60000
                        and type(phase.get("completed")) is bool, "PHASE_REJECTED")
                clean_phases.append({key: phase[key] for key in ("phase", "durationMs", "completed")})
            self.result = {key: value[key] for key in ("event", "admissions", "mode", "caseCount", "diagnosis", "reason", "ok", "cleanupVerified", "runtimeMs", "executeMs",
                                                      "controlsObserved", "budgetObserved", "imageMatched", "limits", "outputBytes", "outputTruncated", "casesCompleted", "infrastructureStatus")}
            self.result["caseTimings"] = clean_timings
            self.result["phases"] = clean_phases
            public = self.result
        elif event == "clean":
            require(not self.clean and self.result is not None and value.get("containers") == 0, "CLEANUP_REJECTED")
            self.clean = True
            public = {"event": event, "containers": 0}
        elif event == "failed":
            raise Rejected("GUEST_REPORTED_FAILURE")
        else:
            raise Rejected("UNKNOWN_GUEST_EVENT")
        return {"hostElapsedMs": elapsed_ms, "bootId": self.admission["bootId"], **public}


def capture(proc, receipt, created, events):
    pending, total = b"", 0
    with selectors.DefaultSelector() as poller:
        poller.register(proc.stdout, selectors.EVENT_READ)
        while True:
            # Absolute creation clock: boot/readiness never grants a new window.
            deadline = created + (CLEANUP if receipt.result is not None else OPERATION)
            remaining = deadline - time.monotonic()
            require(remaining > 0 and poller.select(remaining), "ABSOLUTE_OPERATION_OR_CLEANUP_DEADLINE")
            part = os.read(proc.stdout.fileno(), 16384)
            if not part:
                break
            total += len(part)
            require(total <= 2 * 1024 * 1024, "SERIAL_OUTPUT_LIMIT")
            lines = (pending + part).split(b"\n")
            pending = lines.pop()
            require(len(pending) < MAX_FRAME, "SERIAL_FRAME_LIMIT")
            for line in lines:
                require(len(line) < MAX_FRAME, "SERIAL_FRAME_LIMIT")
                event = receipt.observe(line.decode("utf-8", errors="replace").rstrip("\r"), round((time.monotonic() - created) * 1000, 3))
                if event:
                    events.write(json.dumps(event) + "\n")
                    events.flush()
            if receipt.clean:
                break
    require(receipt.result is not None and receipt.clean, "INCOMPLETE_GUEST_RECEIPT")


def acquire_lock():
    import fcntl
    lock_path = Path("/var/tmp") / ("alunza-single-" + str(os.getuid()) + ".lock")
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = os.fstat(lock_fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1,
                "LOCK_IDENTITY_REJECTED")
        require(info.st_size == 0, "PREVIOUS_RESOURCES_UNRESOLVED")
    except BaseException:
        os.close(lock_fd)
        raise
    return lock_fd


def stop_requested(_signum, _frame):
    raise Rejected("HOST_GUARD_INTERRUPTED")


def run(kit, expected, output, scratch, mode, count, host_receipt, fixture="sum-fixed-v1"):
    global RUN_STARTED
    # Reject cross-profile combinations before hashes, lock, output or scratch.
    validate_workload(mode, count, fixture)
    kit = kit.resolve(strict=True)
    data = verified_kit(kit, expected)
    scratch = scratch.resolve(strict=True)
    require(scratch.is_dir() and not scratch.is_symlink(), "SCRATCH_REJECTED")
    # One local guest per Unix user across every invocation of this harness.
    lock_fd = acquire_lock()
    previous_handlers = {}
    try:
        output.mkdir(mode=0o700, exist_ok=False)
        RUN_STARTED = True
        created, created_epoch = time.monotonic(), round(time.time() * 1000)
        boot_id = str(uuid.uuid4())
        os.write(lock_fd, (boot_id + "\n").encode())
        os.fsync(lock_fd)
        work = Path(tempfile.mkdtemp(prefix="alunza-single-", dir=scratch))
        proc = None
        admission = request(data, mode, count, boot_id, created_epoch, fixture)
        report = {"scope": "LOCAL_ONE_FRESH_GUEST_ONE_EXECUTION", "status": "incomplete", "host": host_receipt,
                  "manifestSha256": expected, "sourceDigest": data["sourceDigest"], "sourceIdentityMode": data["sourceIdentityMode"], "runtime": data["runtime"],
                  "bundleManifestSha256": data["bundleManifestSha256"], "bundleSha256": data["bundleSha256"], "capsuleImageId": data["capsuleImageId"],
                  "bootId": boot_id, "mode": mode, "caseCount": count, "maximumVms": 1, "ttlMs": TTL * 1000,
                  "createdAtEpochMs": created_epoch, "qemuStarted": False,
                  "apiPersistenceAndRemote": "not-tested", "preparedPair": "not-tested"}
        try:
            for signum in (signal.SIGTERM, signal.SIGINT):
                previous_handlers[signum] = signal.signal(signum, stop_requested)
            require(len(os.fsencode(work / "qmp.sock")) < 104, "SCRATCH_SOCKET_PATH_TOO_LONG")
            write_json(work / "request.json", admission)
            write_json(output / "admission.json", admission)
            for source, target in (("root.img", "os.qcow2"), ("docker-store.img", "store.qcow2")):
                remaining = created + OPERATION - time.monotonic()
                require(remaining > 0, "CREATION_DEADLINE")
                subprocess.run(["qemu-img", "create", "-q", "-f", "qcow2", "-o", "backing_fmt=raw", "-b", str(kit / source), target],
                               cwd=work, check=True, timeout=remaining, capture_output=True)
            report["overlaysReadyMs"] = round((time.monotonic() - created) * 1000, 3)
            proc = subprocess.Popen(vm_args(kit, boot_id), cwd=work, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
            report["qemuStarted"] = True
            report["qmp"] = confirm_qmp(work, proc, boot_id, created + OPERATION)
            receipt = Receipt(admission)
            try:
                with (output / "events.jsonl").open("x") as events:
                    capture(proc, receipt, created, events)
            finally:
                # Preserve a valid measured result even when cleanup then fails.
                report["readyMs"], report["result"] = receipt.ready, receipt.result
                report["readinessEvidence"] = receipt.ready_evidence
                report["guestCleanupVerified"] = receipt.clean
            report["status"] = "measured" if receipt.result["ok"] else "measured-with-errors"
        except (Rejected, OSError, ValueError, subprocess.SubprocessError) as error:
            report["status"] = "failed"
            report["failure"] = str(error) if re.fullmatch(r"[A-Z_]+", str(error)) else "LOCAL_MEASUREMENT_FAILED"
        finally:
            # A second catchable signal must not interrupt retirement midway.
            for signum in previous_handlers:
                signal.signal(signum, signal.SIG_IGN)
            cleanup_started = time.monotonic()
            report["qemuReaped"] = proc is None
            try:
                if proc is not None:
                    if proc.poll() is None:
                        os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=max(0.01, created + TTL - time.monotonic()))
                    report["qemuReaped"] = proc.poll() is not None
                    proc.stdout.close()
            except (OSError, subprocess.SubprocessError):
                report["cleanupFailure"] = "QEMU_RETIREMENT_UNCONFIRMED"
            # Only the new directory returned by mkdtemp, never supplied bases.
            if report["qemuReaped"]:
                try:
                    require(work.parent == scratch and work.name.startswith("alunza-single-") and not work.is_symlink(), "CLEANUP_PATH_REJECTED")
                    shutil.rmtree(work)
                except (OSError, Rejected):
                    report["cleanupFailure"] = "SCRATCH_RETIREMENT_UNCONFIRMED"
            report["scratchAbsent"] = not work.exists()
            report["retireMs"] = round((time.monotonic() - cleanup_started) * 1000, 3)
            report["completeMs"] = round((time.monotonic() - created) * 1000, 3)
            report["withinExternalTtl"] = report["completeMs"] <= TTL * 1000
            report["withinInitialCleanup"] = report["completeMs"] <= CLEANUP * 1000
            try:
                report["baseFilesUnchanged"] = all(sha(kit / name) == entry["sha256"] for name, entry in data["files"].items())
            except OSError:
                report["baseFilesUnchanged"] = False
            if not all(report[key] for key in ("qemuReaped", "scratchAbsent", "withinExternalTtl", "withinInitialCleanup", "baseFilesUnchanged")):
                report["status"] = "failed"
            write_json(output / "report.json", report)
            if report["qemuReaped"] and report["scratchAbsent"]:
                os.ftruncate(lock_fd, 0)
                os.fsync(lock_fd)
        return report
    finally:
        for signum, previous in previous_handlers.items():
            signal.signal(signum, previous)
        os.close(lock_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("preflight")
    build = commands.add_parser("bundle")
    build.add_argument("--source-root", type=Path, default=ROOT)
    build.add_argument("--out", type=Path, required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("--artifacts", type=Path, required=True)
    prep.add_argument("--bundle", type=Path, required=True)
    prep.add_argument("--out", type=Path, required=True)
    launch = commands.add_parser("run")
    launch.add_argument("--kit", type=Path, required=True)
    launch.add_argument("--manifest-sha256", required=True)
    launch.add_argument("--out", type=Path, required=True)
    launch.add_argument("--scratch", type=Path, default=Path("/var/tmp"))
    launch.add_argument("--mode", choices=("RUN", "SUBMIT"), required=True)
    launch.add_argument("--cases", type=int, choices=(1, 2, 8), required=True)
    launch.add_argument("--fixture", choices=("sum-fixed-v1", *ADVERSARIAL), default="sum-fixed-v1")
    args = parser.parse_args()
    if args.command == "preflight":
        result = {"status": "host-eligible-not-executed", "host": host()}
    elif args.command == "bundle":
        result = build_bundle(args.source_root, args.out)
    elif args.command == "prepare":
        result = prepare(args.artifacts, args.bundle, args.out)
    else:
        result = run(args.kit, args.manifest_sha256, args.out, args.scratch, args.mode, args.cases, host(), args.fixture)
    print(json.dumps(result, sort_keys=True))
    return int(result.get("status") in ("failed", "measured-with-errors"))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Rejected, OSError, KeyError, TypeError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "failed" if RUN_STARTED else "unavailable-not-executed", "reason": str(error) if re.fullmatch(r"[A-Z_]+", str(error)) else "LOCAL_RUN_FAILED" if RUN_STARTED else "HOST_OR_ARTIFACT_PREREQUISITE_FAILED"}))
        sys.exit(1 if RUN_STARTED else 2)
