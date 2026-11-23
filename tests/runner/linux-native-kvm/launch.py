"""Local two-case SUBMIT measurement on physical Linux. Requires Python 3.9+."""

import argparse
import hashlib
import json
import math
import os
import platform
import re
import selectors
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path


CAPSULE = "sha256:96ffff38bde1000dab2e3cc8da27c760e317ac61cde859e64b3abcfdf16a188c"
BUNDLE = "17ad6ced4473a67b5b670f0a5b5950e851e7e6f9d97f24d75d97608b489d483a"
IMAGES = ("kernel", "root.img", "docker-store.img")


class Rejected(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Rejected(message)


def host():
    require(platform.system() == "Linux" and platform.machine() == "x86_64",
            "physical x86_64 Linux required")
    release = platform.release()
    require(not re.search(r"microsoft|wsl", release, re.I), "WSL host rejected")
    detect = subprocess.run(["systemd-detect-virt"], text=True, capture_output=True, timeout=5)
    require((detect.returncode, detect.stdout.strip()) == (1, "none"),
            "host virtualization or container detected, or detection unavailable")
    fields = Path("/proc/cpuinfo").read_text().splitlines()
    flags = [line.split(":", 1)[1].split() for line in fields if line.startswith("flags") and ":" in line]
    require(flags and all("hypervisor" not in row and ("vmx" in row or "svm" in row) for row in flags),
            "host CPU lacks visible native virtualization or exposes a hypervisor")
    dmi = [Path("/sys/class/dmi/id", name).read_text().strip() for name in ("sys_vendor", "product_name")]
    require(all(dmi) and not re.search(r"virtual machine|vmware|virtualbox|qemu|kvm|hyper-v|bochs|xen|parallels",
                                       " ".join(dmi), re.I), "DMI identifies a virtual host or is unavailable")
    require(stat.S_ISCHR(os.stat("/dev/kvm").st_mode), "/dev/kvm is not a character device")
    import fcntl  # Linux only. Portable offline protocol tests do not require this module.
    with open("/dev/kvm", "rb+", buffering=0) as device:
        version = fcntl.ioctl(device.fileno(), 0xAE00, 0)
    require(version == 12, "unexpected KVM API version")
    binaries = {}
    for name in ("qemu-system-x86_64", "qemu-img"):
        require(shutil.which(name), name + " unavailable")
        result = subprocess.run([name, "--version"], text=True, capture_output=True, check=True, timeout=5)
        binaries[name] = result.stdout.splitlines()[0]
    return {"kernel": release, "kvmApiVersion": version, "systemdDetectVirt": "none", "binaries": binaries}


def digest(path):
    hashed = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hashed.update(chunk)
    return hashed.hexdigest()


def verified_manifest(kit, expected):
    manifest = kit / "guest-manifest.json"
    require(re.fullmatch(r"[a-f0-9]{64}", expected) and manifest.is_file() and not manifest.is_symlink()
            and digest(manifest) == expected, "manifest SHA-256 mismatch")
    data = json.loads(manifest.read_text())
    require(data["schema"] == 1 and data["capsuleConfigDigest"] == CAPSULE and
            data["runnerBundleSha256"] == BUNDLE and set(data["files"]) == set(IMAGES),
            "unexpected kit contract")
    for name, desc in data["files"].items():
        path = kit / name
        require(path.is_file() and not path.is_symlink() and path.stat().st_size == desc["bytes"]
                and digest(path) == desc["sha256"], "kit file mismatch: " + name)
    return data


def vm_args(kit, boot_id, seed):
    cmdline = ("root=/dev/nvme0n1 rw rootwait rootfstype=ext4 init=/opt/parity/init "
               "console=ttyS0,115200 panic=1 alunza.boot_id=" + boot_id)
    if seed:
        cmdline += " alunza.seed=1"
    return [
        "qemu-system-x86_64", "-machine", "q35", "-accel", "kvm", "-cpu", "host", "-smp", "1",
        "-m", "2048", "-uuid", boot_id, "-smbios", "type=1,manufacturer=QEMU,product=AlunzaKVM",
        "-nodefaults", "-no-user-config", "-nic", "none", "-display", "none", "-monitor", "none",
        "-no-reboot", "-S", "-qmp", "unix:qmp.sock,server=on,wait=off", "-serial", "stdio",
        "-kernel", str(kit / "kernel"), "-append", cmdline,
        "-drive", "if=none,id=osdisk,file=os.qcow2,format=qcow2",
        "-drive", "if=none,id=store,file=store.qcow2,format=qcow2",
        "-device", "nvme,id=ctrl,serial=ALUNZAKVM",
        "-device", "nvme-ns,bus=ctrl,drive=osdisk,nsid=1",
        "-device", "nvme-ns,bus=ctrl,drive=store,nsid=2",
    ]


def confirm_qmp(work, proc, boot_id, deadline):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        while True:
            require(proc.poll() is None and time.monotonic() < deadline, "QMP was not available in time")
            try:
                client.connect(str(work / "qmp.sock"))
                break
            except (FileNotFoundError, ConnectionRefusedError):
                time.sleep(0.02)
        with client.makefile("rb") as lines:
            def receive():
                remaining = deadline - time.monotonic()
                require(remaining > 0, "QMP timed out")
                client.settimeout(remaining)
                line = lines.readline(131072)
                require(line.endswith(b"\n"), "QMP session closed or invalid response")
                return json.loads(line)

            def command(name):
                client.sendall((json.dumps({"execute": name, "id": name}) + "\r\n").encode())
                while True:
                    answer = receive()
                    if answer.get("id") == name:
                        require("return" in answer, "QMP rejected " + name)
                        return answer["return"]

            require("QMP" in receive(), "invalid QMP greeting")
            command("qmp_capabilities")
            names = {entry["name"] for entry in command("query-commands")}
            if "query-accelerators" in names:
                method = "query-accelerators"
                require(command(method)["enabled"] == "kvm", "KVM not enabled")
            else:
                method = "query-kvm"
                kvm = command(method)
                require(kvm["enabled"] is True and kvm["present"] is True, "KVM not enabled")
            require(command("query-uuid")["UUID"].lower() == boot_id, "QMP UUID mismatch")
            require(command("query-status")["running"] is False, "guest was not paused for attestation")
            command("cont")
    return {"enabled": "kvm", "verifiedWith": method, "uuid": boot_id}


def finite_ms(value):
    return type(value) in (float, int) and math.isfinite(value) and value >= 0


def sample(data, position):
    group = "two-case-first" if position == 0 else "two-case-series"
    require(data["group"] == group and data["index"] == max(1, position) and position <= 50 and
            data["caseCount"] == 2 and data["mode"] == "SUBMIT" and data["concurrency"] == 1,
            "invalid sample order or workload")
    require(data["cleanupVerified"] is True and data["auditAbsent"] is True,
            "sample cleanup not verified")
    require(type(data["ok"]) is bool and finite_ms(data["executeMs"]), "invalid outcome")
    for key in ("diagnosis", "reason"):
        require(isinstance(data[key], str) and re.fullmatch(r"[A-Z_]{1,48}", data[key]), "invalid outcome code")
    require(len(data["caseTimings"]) == 2, "missing case data")
    timings = []
    for ordinal, visibility in enumerate(("visible", "hidden"), start=1):
        case = data["caseTimings"][ordinal - 1]
        require(case["ordinal"] == ordinal and case["visibility"] == visibility, "case order mismatch")
        require(all(type(case[key]) is bool for key in ("attempted", "created", "started")), "invalid case flags")
        for metric, completed in (("createMs", "created"), ("startMs", "started")):
            require((case[metric] is None and not case[completed]) or
                    (finite_ms(case[metric]) and case["attempted"]), "invalid case timing")
        require((not case["started"] or case["created"]) and (not data["ok"] or case["started"]),
                "inconsistent case completion")
        timings.append({k: case[k] for k in ("ordinal", "visibility", "attempted", "created", "createMs", "started", "startMs")})
    fields = ("group", "index", "executeMs", "diagnosis", "reason", "ok", "cleanupVerified", "auditAbsent")
    return {**{key: data[key] for key in fields}, "caseTimings": timings}


def distribution(values):
    ordered = sorted(values)
    return {"n": len(ordered), **{f"p{p}Ms": ordered[math.ceil(p * len(ordered) / 100) - 1] if ordered else None
                                  for p in (50, 95)}}


class Receipt:
    def __init__(self, boot_id, seed):
        self.boot_id = boot_id
        self.seed = seed
        self.seeded = False
        self.ready_ms = None
        self.began = False
        self.samples = []
        self.errors = None
        self.clean = False
        self.exit_code = None

    def observe(self, line, elapsed_ms):
        tag, _, body = line.partition(" ")
        if tag == "NATIVE_SEEDED":
            require(self.seed and not self.seeded and not self.clean and body == self.boot_id, "unexpected seed marker")
            self.seeded = True
        elif tag == "LATENCY_READY":
            data = json.loads(body)
            require(not self.seed and self.ready_ms is None and data == {"guest": "qemu", "bootId": self.boot_id, "image": CAPSULE},
                    "readiness marker does not match guest, boot or image")
            self.ready_ms = elapsed_ms
        elif tag == "LATENCY_BEGIN":
            data = json.loads(body)
            require(self.ready_ms is not None and not self.began and data["bootId"] == self.boot_id and
                    data["boot"] == "preseeded-submit" and data["guest"] == "qemu" and data["twoCaseSubmit"] == 50,
                    "unexpected benchmark start")
            self.began = True
        elif tag == "LATENCY_SAMPLE":
            require(self.began and self.errors is None, "sample outside measurement")
            row = sample(json.loads(body), len(self.samples))
            self.samples.append(row)
            return {"tag": tag, "data": row}
        elif tag == "LATENCY_END":
            data = json.loads(body)
            errors = sum(not row["ok"] for row in self.samples)
            require(self.began and self.errors is None and len(self.samples) == 51 and
                    data["boot"] == "preseeded-submit" and data["attempts"] == 51 and
                    data["errors"] == errors and data["finalContainers"] == 0, "incomplete or invalid final totals")
            self.errors = errors
        elif tag == "LATENCY_FAILED":
            raise Rejected("guest benchmark reported an instrument or cleanup failure")
        elif tag == "GUEST_CLEAN":
            require(not self.clean and (self.seeded or self.errors is not None) and body == "containers=0",
                    "unexpected guest cleanup")
            self.clean = True
        elif tag == "GUEST_FINISH":
            require(self.clean and self.exit_code is None and body == ("1" if self.errors else "0"),
                    "guest termination is incomplete or inconsistent")
            self.exit_code = int(body)
        else:
            return None
        return {"tag": tag}

    def result(self):
        require(self.exit_code is not None, "guest stopped without verified completion")
        if self.seed:
            return {"imageSeeded": True, "zeroContainers": self.clean}
        hot = self.samples[1:]
        capsules = []
        for offset, visibility in enumerate(("visible", "hidden")):
            cases = [row["caseTimings"][offset] for row in hot]
            observed = [case["startMs"] for case in cases if case["startMs"] is not None]
            capsules.append({"visibility": visibility, "startMs": distribution(observed),
                             "failedStarts": sum(case["startMs"] is not None and not case["started"] for case in cases),
                             "missingStarts": len(cases) - len(observed)})
        return {"readyFromLaunchMs": self.ready_ms, "firstSubmit": self.samples[0],
                "warmSubmit": {"attempts": len(hot), "errors": sum(not row["ok"] for row in hot),
                               "executeMs": distribution(row["executeMs"] for row in hot), "capsules": capsules},
                "allErrors": self.errors, "zeroContainers": self.clean}


def capture(proc, receipt, started, deadline, events):
    pending = b""
    with selectors.DefaultSelector() as poller:
        poller.register(proc.stdout, selectors.EVENT_READ)
        while True:
            wait = deadline - time.monotonic()
            require(wait > 0, "boot watchdog expired")
            if not poller.select(wait):
                raise Rejected("boot watchdog expired")
            part = os.read(proc.stdout.fileno(), 16384)
            if not part:
                break
            lines = (pending + part).split(b"\n")
            pending = lines.pop()
            require(len(pending) < 65536, "invalid serial frame")
            for line in lines:
                ms = round((time.monotonic() - started) * 1000, 3)
                event = receipt.observe(line.decode("utf-8", errors="replace").rstrip("\r"), ms)
                if event:
                    events.write(json.dumps({"bootId": receipt.boot_id, "hostElapsedMs": ms, **event}) + "\n")
                    events.flush()
    require(proc.wait(timeout=max(0.01, deadline - time.monotonic())) == 0, "QEMU exited abnormally")
    return receipt.result()


def boot(kit, work, seed, events):
    boot_id = str(uuid.uuid4())
    # Place the origin directly before process creation; QMP attestation and cont are included.
    args = vm_args(kit, boot_id, seed)
    started = time.monotonic()
    proc = subprocess.Popen(args, cwd=work, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        qmp = confirm_qmp(work, proc, boot_id, started + 30)
        receipt = Receipt(boot_id, seed)
        result = capture(proc, receipt, started, started + (650 if seed else 1950), events)
        return {"mode": "seed" if seed else "preseeded-submit", "qmp": qmp, **result}
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        proc.stdout.close()
        (work / "qmp.sock").unlink(missing_ok=True)


def overlay(work, backing, filename):
    subprocess.run(["qemu-img", "create", "-q", "-f", "qcow2", "-F", "raw", "-b", str(backing), filename],
                   cwd=work, check=True, timeout=60)


def run(args, host_receipt):
    kit = args.kit.resolve(strict=True)
    manifest = verified_manifest(kit, args.manifest_sha256)
    out = args.out.resolve()
    out.mkdir(mode=0o700, exist_ok=False)
    report = {"scope": "LOCAL_NATIVE_KVM", "host": host_receipt, "manifestSha256": args.manifest_sha256,
              "files": manifest["files"], "boots": [], "status": "incomplete"}
    try:
        with tempfile.TemporaryDirectory(prefix="alunza-kvm-", dir=args.scratch) as temp:
            work = Path(temp).resolve()
            require(len(os.fsencode(work / "qmp.sock")) < 104, "scratch path too long for QMP")
            with (out / "events.jsonl").open("x") as events:
                overlay(work, kit / "docker-store.img", "store.qcow2")
                for seed in (True, False):
                    overlay(work, kit / "root.img", "os.qcow2")
                    report["boots"].append(boot(kit, work, seed, events))
                    (work / "os.qcow2").unlink()
        report["scratchRemoved"] = not work.exists()
        require(report["scratchRemoved"], "working disks not removed")
        report["status"] = "measured-with-errors" if report["boots"][-1]["allErrors"] else "measured"
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return int(report["status"] == "measured-with-errors")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--kit", type=Path)
    parser.add_argument("--manifest-sha256")
    parser.add_argument("--out", type=Path, help="New directory to retain the report and sanitized measurements")
    parser.add_argument("--scratch", type=Path, default=Path("/var/tmp"), help="Existing local filesystem for overlays")
    args = parser.parse_args()
    if not args.preflight and not (args.kit and args.manifest_sha256 and args.out):
        parser.error("a run requires --kit, --manifest-sha256 and --out")
    checks = host()
    if args.preflight:
        print(json.dumps({"scope": "LOCAL_NATIVE_KVM_PREFLIGHT", "eligible": True, **checks}))
        return 0
    return run(args, checks)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Rejected, OSError, KeyError, TypeError, ValueError, subprocess.SubprocessError) as err:
        print(f"Native KVM measurement unavailable: {err}", file=sys.stderr)
        sys.exit(2)
