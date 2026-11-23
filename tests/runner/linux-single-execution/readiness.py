"""Read-only host inventory. The frozen launch.host() remains the run authority."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
VIRTUAL_DMI = r"virtual machine|vmware|virtualbox|qemu|kvm|hyper-v|bochs|xen|parallels"
TOOLS = {"qemu-system-x86_64": ("--version", "run"),
         "qemu-img": ("--version", "run"), "debugfs": ("-V", "prepare")}


def read_text(path):
    with Path(path).open(encoding="utf-8", errors="replace") as stream:
        text = stream.read(2 * 1024 * 1024 + 1)
    if len(text) > 2 * 1024 * 1024:
        raise ValueError("observation exceeds bound")
    return text


def run_command(arguments):
    return subprocess.run(arguments, capture_output=True, text=True, timeout=5, check=False)


def device_info():
    entry = os.stat("/dev/kvm")
    return {"characterDevice": stat.S_ISCHR(entry.st_mode),
            "readAccess": os.access("/dev/kvm", os.R_OK),
            "writeAccess": os.access("/dev/kvm", os.W_OK)}


def kvm_api():
    import fcntl  # Not imported on Windows; GET_API_VERSION never creates a VM.
    with open("/dev/kvm", "rb+", buffering=0) as device:
        return fcntl.ioctl(device.fileno(), 0xAE00, 0)


def authoritative_host():
    spec = importlib.util.spec_from_file_location("alunza_frozen_host_authority", HERE / "launch.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.host()


def resources(scratch, linux):
    result = {"minimumsInvented": False}
    try:
        if not linux:
            raise NotImplementedError()
        match = re.search(r"^MemAvailable:\s+(\d+) kB$", read_text("/proc/meminfo"), re.M)
        if not match:
            raise ValueError()
        result["memory"] = {"status": "observed", "availableBytes": int(match[1]) * 1024}
    except (OSError, ValueError, NotImplementedError) as error:
        result["memory"] = {"status": "unknown", "errorType": type(error).__name__}
    try:
        usage = shutil.disk_usage(scratch)
        result["disk"] = {"status": "observed", "totalBytes": usage.total, "freeBytes": usage.free}
    except (OSError, ValueError) as error:
        result["disk"] = {"status": "unknown", "errorType": type(error).__name__}
    return result


def inspect_host(scratch=Path("/var/tmp")):
    checks = []

    def add(identifier, required_for, observe, accepts, action, enabled=True):
        if not enabled:
            row = {"id": identifier, "requiredFor": required_for, "status": "unknown",
                   "observed": {"reason": "PREREQUISITE_NOT_MET"}, "action": action}
        else:
            try:
                value = observe()
                row = {"id": identifier, "requiredFor": required_for,
                       "status": "pass" if accepts(value) else "fail", "observed": value, "action": action}
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, ImportError, AttributeError, SyntaxError, KeyError, TypeError) as error:
                row = {"id": identifier, "requiredFor": required_for, "status": "unknown",
                       "observed": {"errorType": type(error).__name__}, "action": action}
        checks.append(row)
        return row

    linux = platform.system() == "Linux" and sys.platform == "linux"
    add("platform", "run", lambda: {"system": platform.system(), "architecture": platform.machine()},
        lambda value: linux and value["architecture"] == "x86_64",
        "Usar un host Linux físico x86-64; Windows/WSL/VM no acreditan este ensayo.")
    add("kernel-native", "run", lambda: {"release": platform.release()},
        lambda value: not re.search(r"microsoft|wsl", value["release"], re.I),
        "Seleccionar Linux físico; no desactivar la detección de WSL o virtualización.", linux)

    def virtualization():
        response = run_command(["systemd-detect-virt"])
        detected = response.stdout.strip()
        return {"exitCode": response.returncode, "detectedNone": detected == "none",
                "virtualizationReported": response.returncode == 0}

    add("virtualization", "run", virtualization,
        lambda value: value["exitCode"] == 1 and value["detectedNone"],
        "Obtener systemd-detect-virt=none con salida 1 en el host físico.", linux)

    def cpu():
        rows = [line.split(":", 1)[1].split() for line in read_text("/proc/cpuinfo").splitlines()
                if line.startswith("flags") and ":" in line]
        if not rows:
            raise ValueError("CPU flags unavailable")
        return {"observedCpuRows": len(rows), "hardwareVirtualizationOnAll": all("vmx" in row or "svm" in row for row in rows),
                "hypervisorFlagPresent": any("hypervisor" in row for row in rows)}

    add("cpu-virtualization", "run", cpu,
        lambda value: value["hardwareVirtualizationOnAll"] and not value["hypervisorFlagPresent"],
        "Comprobar soporte y habilitación de virtualización del host físico; no ejecutar anidado.", linux)

    def dmi():
        values = [read_text("/sys/class/dmi/id/" + name).strip() for name in ("sys_vendor", "product_name")]
        if not all(values):
            raise ValueError("DMI incomplete")
        # No hostname, serial, UUID or raw DMI values leave this process.
        return {"vendorPresent": True, "productPresent": True,
                "virtualMachineMarker": bool(re.search(VIRTUAL_DMI, " ".join(values), re.I))}

    add("dmi", "run", dmi, lambda value: not value["virtualMachineMarker"],
        "Facilitar lectura de DMI del host físico; DMI ausente no equivale a aprobado.", linux)
    device = add("kvm-device", "run", device_info,
                 lambda value: all(value.values()),
                 "Disponer de /dev/kvm como dispositivo de caracteres y acceso autorizado de lectura/escritura.", linux)
    add("kvm-api", "run", lambda: {"version": kvm_api()}, lambda value: value["version"] == 12,
        "Acreditar KVM_GET_API_VERSION=12; no se crea ninguna VM en esta consulta.", device["status"] == "pass")

    for name, (argument, required_for) in TOOLS.items():
        def tool(tool_name=name, option=argument):
            executable = shutil.which(tool_name)
            if executable is None:
                return {"available": False, "version": None}
            response = run_command([executable, option])
            lines = (response.stdout or response.stderr).splitlines()
            version = re.sub(r"[\x00-\x1f\x7f]", "", lines[0])[:200] if lines else None
            return {"available": True, "exitCode": response.returncode, "version": version}
        add(name, required_for, tool,
            lambda value: value["available"] and value.get("exitCode") == 0 and bool(value["version"]),
            "Aportar " + name + " disponible y versionado; este inspector no instala herramientas.", linux)

    authority = add("launch-host-authority", "run", lambda: {"accepted": bool(authoritative_host())},
                    lambda value: value["accepted"],
                    "Conservar launch.py y ../linux-native-kvm/launch.py del candidato y superar launch.host().")
    eligible = authority["status"] == "pass" and all(row["status"] == "pass" for row in checks if row["requiredFor"] == "run")
    return {"schemaVersion": 1, "scope": "READ_ONLY_HOST_PREPARATION", "vmStarted": False,
            "status": "host-eligible-not-executed" if eligible else "unavailable-not-executed",
            "hostEligible": eligible,
            "prepareToolsAvailable": all(row["status"] == "pass" for row in checks if row["requiredFor"] == "prepare"),
            "checks": checks, "resources": resources(scratch, linux),
            "limitations": ["Host readiness does not validate kernel/root/store artifacts or accept physical execution.",
                            "debugfs is needed for offline preparation, not for running an already verified kit."]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("host",))
    parser.add_argument("--scratch", type=Path, default=Path("/var/tmp"))
    args = parser.parse_args(argv)
    report = inspect_host(args.scratch)
    print(json.dumps(report, sort_keys=True))
    return 0 if report["hostEligible"] else 2


if __name__ == "__main__":
    sys.exit(main())
