"""Opt-in local Linux broker: one fresh KVM guest per admitted execution.

Only a private Unix socket is served. Student source is data for the guest.
The independent guardian owns retirement even when the API/broker disappears.
"""
import argparse
import ctypes
import datetime
import fcntl
import hashlib
import http.server
import json
import os
import re
import selectors
import shutil
import signal
import socket
import socketserver
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from protocol import (ARTIFACTS, BODY_LIMIT, RESULT_LIMIT, VERSION, Rejected, context,
                      digest_file, durable_json, encoded, hash_value, identity, input_value,
                      number, parse_json, private_directory, require, result_value,
                      same_installation, uuid_value)

HERE = Path(__file__).resolve().parent
SEALS = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
PREFIX = b'ALUNZA_VM '
ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


def seals_ok(fd):
    require(fcntl.fcntl(fd, fcntl.F_GET_SEALS) & SEALS == SEALS, 'BASE_NOT_SEALED')


class SealedKit:
    def __init__(self, directory, expected):
        self.fds = {}
        try:
            raw = (directory / 'guest-manifest.json').read_bytes()
            require(hash_value(expected) and hashlib.sha256(raw).hexdigest() == expected, 'KIT_MANIFEST_MISMATCH')
            self.manifest = parse_json(raw, 1048576)
            data = self.manifest
            require(data.get('schemaVersion') == 1 and data.get('scope') == 'LOCAL_VM_API'
                    and data.get('runnerVersion') == 'imp-03-quickjs.13'
                    and data.get('virginBase') == 'supplied-declaration-not-forensic-proof'
                    and set(data.get('files', {})) == set(ARTIFACTS), 'KIT_CONTRACT_REJECTED')
            for name in ARTIFACTS:
                item = data['files'][name]
                require(type(item.get('bytes')) is int and 0 < item['bytes'] <= 3221225472
                        and hash_value(item.get('sha256')), 'KIT_FILE_METADATA')
                source = os.open(directory / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
                target = os.memfd_create('alunza-' + name, os.MFD_ALLOW_SEALING | os.MFD_CLOEXEC)
                self.fds[name] = target
                try:
                    info = os.fstat(source)
                    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size == item['bytes'], 'KIT_FILE_REJECTED')
                    copied = 0
                    while True:
                        block = os.read(source, 1048576)
                        if not block:
                            break
                        copied += len(block)
                        require(copied <= item['bytes'], 'KIT_FILE_GREW')
                        view = memoryview(block)
                        while view:
                            view = view[os.write(target, view):]
                    require(copied == item['bytes'], 'KIT_FILE_SIZE')
                finally:
                    os.close(source)
                fcntl.fcntl(target, fcntl.F_ADD_SEALS, SEALS)
                seals_ok(target)
                # Hash the immutable copy, not a racy path before copying.
                digest = hashlib.sha256()
                position = 0
                while position < item['bytes']:
                    block = os.pread(target, min(1048576, item['bytes'] - position), position)
                    require(block, 'SEALED_BASE_TRUNCATED')
                    digest.update(block)
                    position += len(block)
                require(digest.hexdigest() == item['sha256'], 'SEALED_BASE_HASH_MISMATCH')
        except BaseException:
            self.close()
            raise

    def check(self):
        for name, fd in self.fds.items():
            seals_ok(fd)
            require(os.fstat(fd).st_size == self.manifest['files'][name]['bytes'], 'SEALED_BASE_SIZE')

    def close(self):
        for fd in self.fds.values():
            os.close(fd)
        self.fds.clear()


def start_ticks(pid):
    return int(Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()[19])


def boot_identity():
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def identified_pidfd(pid, ticks, boot_id=None):
    if boot_id is not None and boot_id != boot_identity():
        return None
    fd = None
    try:
        fd = os.pidfd_open(pid)
        require(start_ticks(pid) == ticks, 'PROCESS_IDENTITY_CHANGED')
        return fd
    except (ProcessLookupError, FileNotFoundError):
        if fd is not None:
            os.close(fd)
        return None
    except BaseException:
        if fd is not None:
            os.close(fd)
        raise


def exited(fd):
    with selectors.DefaultSelector() as selected:
        selected.register(fd, selectors.EVENT_READ)
        return bool(selected.select(0))


def stop_pid(pid, ticks, sig, boot_id=None):
    fd = identified_pidfd(pid, ticks, boot_id)
    if fd is None:
        return True
    try:
        if not exited(fd):
            signal.pidfd_send_signal(fd, sig)
        return exited(fd)
    finally:
        os.close(fd)


def vm_args(fds, boot_id):
    return ['qemu-system-x86_64', '-machine', 'q35,sata=off,i8042=off', '-accel', 'kvm', '-cpu', 'host',
            '-smp', '1', '-m', '2048', '-uuid', boot_id, '-smbios', 'type=1,manufacturer=QEMU,product=AlunzaSingleExecution',
            '-nodefaults', '-no-user-config', '-nic', 'none', '-display', 'none', '-monitor', 'none', '-no-reboot',
            '-S', '-qmp', 'unix:qmp.sock,server=on,wait=off', '-serial', 'stdio', '-rtc', 'base=utc,clock=host',
            '-kernel', '/proc/self/fd/' + str(fds['kernel']), '-append',
            'root=/dev/vda rw rootwait rootfstype=ext4 init=/lib/systemd/systemd systemd.unit=alunza-single.target console=ttyS0,115200 panic=1 quiet systemd.show_status=error',
            '-fw_cfg', 'name=opt/alunza/request,file=request.json',
            '-drive', 'if=none,id=osdisk,file=os.qcow2,format=qcow2',
            '-drive', 'if=none,id=store,file=store.qcow2,format=qcow2',
            '-device', 'virtio-blk-pci,drive=osdisk,serial=ALUNZAROOT',
            '-device', 'nvme,id=ctrl,serial=ALUNZASINGLE', '-device', 'nvme-ns,bus=ctrl,drive=store,nsid=1']


def confirm_qmp(work, proc, boot_id, deadline):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        while True:
            require(proc.poll() is None and time.monotonic() < deadline, 'QMP_UNAVAILABLE')
            try:
                client.connect(str(work / 'qmp.sock'))
                break
            except (FileNotFoundError, ConnectionRefusedError):
                time.sleep(0.01)
        with client.makefile('rb') as stream:
            def receive():
                remaining = deadline - time.monotonic()
                require(remaining > 0, 'QMP_DEADLINE')
                client.settimeout(remaining)
                line = stream.readline(131072)
                require(line.endswith(b'\n'), 'QMP_FRAME_REJECTED')
                return parse_json(line, 131072)
            def command(name):
                client.sendall(encoded({'execute': name, 'id': name}) + b'\r\n')
                while True:
                    result = receive()
                    if result.get('id') == name:
                        require('return' in result, 'QMP_COMMAND_REJECTED')
                        return result['return']
            require('QMP' in receive(), 'QMP_GREETING_REJECTED')
            command('qmp_capabilities')
            kvm = command('query-kvm')
            require(kvm.get('enabled') is True and kvm.get('present') is True, 'KVM_NOT_ENABLED')
            require(command('query-uuid')['UUID'].lower() == boot_id, 'QMP_UUID_MISMATCH')
            require(command('query-status')['running'] is False, 'GUEST_ALREADY_RUNNING')
            require(len(command('query-cpus-fast')) == 1, 'GUEST_CPU_MISMATCH')
            memory = command('query-memory-size-summary')
            require(memory.get('base-memory') == 2147483648 and memory.get('plugged-memory', 0) == 0, 'GUEST_MEMORY_MISMATCH')
            command('cont')
    return {'vcpus': 1, 'memoryBytes': 2147483648, 'network': False}


class Receipt:
    def __init__(self, admission):
        self.admission, self.ready, self.result, self.clean = admission, False, None, False
        self.envelope = None
        self.input = input_value(admission['inputJson'], admission['executionId'], admission['inputSha256'])

    def accept(self, line):
        if not line.startswith(PREFIX):
            return
        message = parse_json(line[len(PREFIX):], RESULT_LIMIT)
        require(all(message.get(key) == self.admission[key] for key in ('executionId', 'creationId', 'bootId')), 'GUEST_IDENTITY_MISMATCH')
        event = message.get('event')
        if event == 'ready':
            require(not self.ready and self.result is None and not self.clean, 'DUPLICATE_READY')
            runtime = self.admission['runtime']
            require(message.get('sourceDigest') == self.admission['sourceDigest']
                    and message.get('runtime') == runtime['runtime'] and message.get('runtimeVersion') == runtime['runtimeVersion']
                    and message.get('runnerVersion') == self.admission['context']['runnerVersion']
                    and message.get('strategy') == 'cold' and message.get('daemonInEnvelope') is True
                    and message.get('supervisorInEnvelope') is True, 'GUEST_READINESS_MISMATCH')
            envelope = message.get('envelope')
            require(isinstance(envelope, dict) and set(envelope) == {'cpuCount', 'memoryMax', 'swapMax', 'cpuMax',
                    'selfGroup', 'cgroupVersion', 'cgroupDriver'} and type(envelope['cpuCount']) is int
                    and envelope['cpuCount'] == 1 and envelope['memoryMax'] == '2147483648'
                    and envelope['swapMax'] == '0' and envelope['cgroupVersion'] == '2'
                    and envelope['cgroupDriver'] == 'systemd' and isinstance(envelope['selfGroup'], str)
                    and envelope['selfGroup'].startswith('0::/alunzasingleexecutor.slice/')
                    and isinstance(envelope['cpuMax'], str) and re.fullmatch(r'[1-9][0-9]* [1-9][0-9]*', envelope['cpuMax']), 'GUEST_ENVELOPE_REJECTED')
            quota, period = map(int, envelope['cpuMax'].split())
            require(quota <= period, 'GUEST_CPU_ENVELOPE_REJECTED')
            self.envelope = envelope
            self.ready = True
        elif event == 'result':
            require(self.ready and self.result is None and not self.clean and message.get('admissions') == 1, 'RESULT_SEQUENCE')
            self.result = result_value(message.get('result'), self.input, self.admission['context'])
        elif event == 'clean':
            require(self.result is not None and not self.clean and type(message.get('containers')) is int
                    and message['containers'] == 0, 'CLEAN_SEQUENCE')
            self.clean = True
        else:
            raise Rejected('GUEST_FAILED')


def capture(proc, receipt, normal_deadline, cleanup_deadline):
    pending, total = bytearray(), 0
    with selectors.DefaultSelector() as selected:
        selected.register(proc.stdout, selectors.EVENT_READ)
        while not receipt.clean:
            deadline = cleanup_deadline if receipt.result is not None else normal_deadline
            remaining = deadline - time.monotonic()
            require(remaining > 0, 'GUEST_ABSOLUTE_DEADLINE')
            for key, _ in selected.select(min(remaining, 0.1)):
                block = os.read(key.fd, 65536)
                require(block, 'GUEST_PROTOCOL_INCOMPLETE')
                total += len(block)
                require(total <= BODY_LIMIT, 'GUEST_OUTPUT_LIMIT')
                pending.extend(block)
                while b'\n' in pending:
                    line, _, tail = pending.partition(b'\n')
                    pending = bytearray(tail)
                    require(len(line) <= RESULT_LIMIT, 'GUEST_FRAME_LIMIT')
                    receipt.accept(bytes(line.rstrip(b'\r')))
                require(len(pending) <= RESULT_LIMIT, 'GUEST_FRAME_LIMIT')


def terminate_guardian(_signum, _frame):
    raise Rejected('GUARDIAN_CANCELLED')


def watchdog(pidfd, group, deadline):
    """Separate session; pidfd prevents a recycled PID from becoming a target."""
    with selectors.DefaultSelector() as selected:
        selected.register(pidfd, selectors.EVENT_READ)
        if not selected.select(max(0, deadline - time.monotonic())):
            if not exited(pidfd):
                os.killpg(group, signal.SIGKILL)


def qemu_wrapper(parent, arguments):
    # No Python preexec_fn in the multithreaded broker. This trusted standalone
    # child sets PDEATHSIG before exec and closes the fork/death race explicitly.
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(1, signal.SIGKILL, 0, 0, 0) == 0, 'PDEATHSIG_FAILED')
    require(os.getppid() == parent, 'GUARDIAN_ALREADY_GONE')
    os.execvpe(arguments[0], arguments, ENV)


def guardian(state_file, base_fds, lock_fd):
    os.umask(0o077)
    state = parse_json(state_file.read_bytes())
    work, terminal = Path(state['work']), Path(state['terminal'])
    private_directory(work)
    resource = state['resource']
    admission = parse_json((work / 'request.json').read_bytes())
    created = state['createdMonotonic']
    normal, cleanup, ttl = created + 30, created + 40, created + 60
    require(time.monotonic() < normal, 'ADMISSION_EXPIRED')
    for fd in base_fds.values():
        seals_ok(fd)
    durable_json(Path(state['guardianIdentity']), {'pid': os.getpid(), 'ticks': start_ticks(os.getpid()), 'bootId': boot_identity()})
    own_pidfd = os.pidfd_open(os.getpid())
    watcher = subprocess.Popen([sys.executable, str(HERE / 'broker.py'), '_watchdog', str(own_pidfd),
                                str(os.getpgrp()), str(ttl)], pass_fds=(own_pidfd,), env=ENV,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               start_new_session=True)
    os.close(own_pidfd)
    proc, receipt, qmp, failure = None, Receipt(admission), None, None
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, terminate_guardian)
    try:
        for source, target in (('root.img', 'os.qcow2'), ('docker-store.img', 'store.qcow2')):
            remaining = normal - time.monotonic()
            require(remaining > 0, 'CREATION_DEADLINE')
            subprocess.run(['qemu-img', 'create', '-q', '-f', 'qcow2', '-o', 'backing_fmt=raw',
                            '-b', '/proc/self/fd/' + str(base_fds[source]), target], cwd=work,
                           pass_fds=tuple(base_fds.values()), env=ENV, check=True, timeout=remaining,
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        proc = subprocess.Popen([sys.executable, str(HERE / 'broker.py'), '_qemu', str(os.getpid()),
                                 *vm_args(base_fds, resource['resourceId'])], cwd=work, env=ENV,
                                pass_fds=tuple(base_fds.values()), stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        durable_json(Path(state['qemuIdentity']), {'pid': proc.pid, 'ticks': start_ticks(proc.pid), 'bootId': boot_identity()})
        qmp = confirm_qmp(work, proc, resource['resourceId'], normal)
        capture(proc, receipt, normal, cleanup)
    except (Rejected, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        failure = str(error) if isinstance(error, Rejected) and re.fullmatch(r'[A-Z0-9_]+', str(error)) else 'VM_EXECUTION_FAILED'
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, signal.SIG_IGN)
        reaped = proc is None
        try:
            if proc is not None:
                if proc.poll() is None:
                    proc.kill()
                proc.wait(timeout=max(0.01, cleanup - time.monotonic()))
                reaped = proc.returncode is not None
                proc.stdout.close()
                # Technical stderr is private and bounded, never an HTTP field.
                os.set_blocking(proc.stderr.fileno(), False)
                diagnostic = proc.stderr.read(32768) or b''
                proc.stderr.close()
                if diagnostic:
                    path = terminal.with_suffix('.stderr.txt')
                    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(diagnostic)
            if reaped:
                require(work.parent == Path(state['scratch']) and work.name == 'execution-' + resource['resourceId']
                        and not work.is_symlink(), 'SCRATCH_IDENTITY_MISMATCH')
                shutil.rmtree(work)
        except (Rejected, OSError, subprocess.SubprocessError):
            failure = 'VM_RETIREMENT_UNCONFIRMED'
        clean = reaped and not work.exists() and time.monotonic() <= cleanup
        evidence = {'bootId': resource['resourceId'], 'executionId': resource['executionId'],
                    'creationId': resource['creationId'],
                    **{key: resource['context'][key] for key in ('hostId', 'brokerGeneration', 'kitManifestSha256', 'image', 'runnerVersion')},
                    'qemu': qmp, 'envelope': receipt.envelope, 'capsulesClean': receipt.clean, 'qemuReaped': reaped, 'overlaysAbsent': not work.exists()}
        response = {'result': receipt.result, 'resource': resource, 'cleanupVerified': clean, 'vmEvidence': evidence}
        durable_json(terminal, {'state': 'CLOSED', 'response': response,
                               'failure': failure or (None if clean and receipt.clean and receipt.result is not None else 'VM_RESULT_INCOMPLETE'),
                               'qemuStarted': proc is not None, 'completeMs': (time.monotonic() - created) * 1000})
        # Watchdog remains independent until this process exits. It observes our
        # pidfd; never wait for it here (that would deadlock until the TTL).


class Broker:
    def __init__(self, kit_path, expected, state_dir, scratch, host_id):
        require(sys.platform == 'linux' and uuid_value(host_id), 'LINUX_HOST_ID_REQUIRED')
        self.state_dir, self.scratch = private_directory(state_dir), private_directory(scratch)
        self.lock = threading.RLock()
        self.processes = {}
        self.lock_fd = os.open(self.state_dir / 'broker.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        lock_info = os.fstat(self.lock_fd)
        require(stat.S_ISREG(lock_info.st_mode) and lock_info.st_nlink == 1
                and lock_info.st_uid == os.getuid() and lock_info.st_mode & 0o077 == 0, 'LOCK_IDENTITY_REJECTED')
        fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            self.kit = SealedKit(kit_path, expected)
        except BaseException:
            os.close(self.lock_fd)
            raise
        self.context = context({'provider': 'local-vm', 'image': self.kit.manifest['capsuleImageId'],
                                'runnerVersion': 'imp-03-quickjs.13', 'hostId': host_id,
                                'kitManifestSha256': expected, 'brokerVersion': VERSION,
                                'guestSha256': self.kit.manifest['guestEntrypointSha256'], 'brokerGeneration': str(uuid.uuid4())})
        self.records = {}
        for path in self.state_dir.glob('record-*.json'):
            data = parse_json(path.read_bytes())
            require(path.name == 'record-' + data['resource']['executionId'] + '.json', 'STATE_PATH_MISMATCH')
            identity(data['resource'])
            self.records[data['resource']['executionId']] = data

    def save(self, record):
        durable_json(self.state_dir / ('record-' + record['resource']['executionId'] + '.json'), record)
        self.records[record['resource']['executionId']] = record

    def refresh(self, record):
        if record.get('terminal') and Path(record['terminal']).exists():
            terminal = parse_json(Path(record['terminal']).read_bytes())
            require(terminal['response']['resource'] == record['resource'], 'TERMINAL_IDENTITY_MISMATCH')
            record['state'] = 'CLOSED'
            record['terminalData'] = terminal
        proc = self.processes.get(record['resource']['executionId'])
        if proc is not None and proc.poll() is not None:
            proc.wait()
            del self.processes[record['resource']['executionId']]
        return record

    def resolve(self, request, create=False):
        identity(request)
        record = self.records.get(request['executionId'])
        if record is not None:
            require(record['resource']['creationId'] == request['creationId']
                    and record['resource']['context'] == request['context']
                    and request['resourceId'] in (None, record['resource']['resourceId']), 'RESOURCE_IDENTITY_MISMATCH')
            return self.refresh(record)
        require(same_installation(request['context'], self.context), 'INSTALLATION_MISMATCH')
        if create:
            require(request['resourceId'] is None, 'UNKNOWN_RESOURCE')
            record = {'state': 'CLOSED', 'resource': {key: request[key] for key in ('executionId', 'creationId', 'resourceId', 'context')}, 'notStarted': True}
            self.save(record)
            return record
        raise Rejected('RESOURCE_UNKNOWN')

    def capacity(self):
        """Caller holds lock. Observation never frees an uncertain resource."""
        busy = False
        for record in self.records.values():
            self.refresh(record)
            clean = (record.get('notStarted') is True
                     or record.get('recoveryCleanupVerified') is True
                     or record.get('terminalData', {}).get('response', {}).get('cleanupVerified') is True)
            if record['state'] == 'CLOSED':
                if not clean:
                    return 'UNCERTAIN'
            elif record['state'] == 'PREPARED':
                if record['prepared']['normalDeadlineMs'] <= time.time() * 1000:
                    return 'UNCERTAIN'
                busy = True
            elif record['state'] == 'STARTING':
                if self.guardian_absent(record):
                    return 'UNCERTAIN'
                busy = True
            else:
                return 'UNCERTAIN'
        return 'BUSY' if busy else 'READY'

    def prepare(self, value):
        require(set(value) == {'executionId', 'creationId', 'context', 'normalDeadlineMs', 'cleanupDeadlineMs', 'inputSha256'}, 'PREPARE_FIELDS')
        identity(value, resource=False)
        require(value['context'] == self.context and hash_value(value['inputSha256']), 'PREPARE_CONTEXT')
        now = time.time() * 1000
        require(number(value['normalDeadlineMs'], 9007199254740991) and number(value['cleanupDeadlineMs'], 9007199254740991)
                # Match Number.isSafeInteger in the pinned guest before any
                # reservation, scratch write or VM can be created.
                and all(int(value[key]) == value[key] for key in ('normalDeadlineMs', 'cleanupDeadlineMs'))
                and now < value['normalDeadlineMs'] <= now + 30000
                and value['cleanupDeadlineMs'] == value['normalDeadlineMs'] + 10000, 'DEADLINE_REJECTED')
        existing = self.records.get(value['executionId'])
        if existing:
            require(existing['state'] == 'PREPARED' and existing['prepared'] == value, 'ADMISSION_ALREADY_USED')
            return {'resourceId': existing['resource']['resourceId'], 'context': self.context}
        require(self.capacity() == 'READY', 'BROKER_BUSY_OR_UNCERTAIN')
        self.kit.check()
        resource = {'executionId': value['executionId'], 'creationId': value['creationId'],
                    'resourceId': str(uuid.uuid4()), 'context': self.context}
        record = {'state': 'PREPARED', 'prepared': value, 'resource': resource}
        self.save(record)
        return {'resourceId': resource['resourceId'], 'context': self.context}

    def start(self, value):
        require(set(value) == {'executionId', 'creationId', 'resourceId', 'context', 'inputJson'}, 'START_FIELDS')
        with self.lock:
            record = self.resolve(value)
            require(value['context'] == self.context, 'STALE_BROKER_GENERATION')
            if record['state'] == 'CLOSED' and record.get('terminalData'):
                input_value(value['inputJson'], value['executionId'], record['prepared']['inputSha256'])
                return self.completed(record)
            require(record['state'] == 'PREPARED', 'ADMISSION_ALREADY_USED')
            admission = record['prepared']
            input_value(value['inputJson'], value['executionId'], admission['inputSha256'])
            require(time.time() * 1000 < admission['normalDeadlineMs'], 'ADMISSION_EXPIRED')
            self.kit.check()
            # Persistent STARTING first. An interrupted start can only retire;
            # it can never be retried with another VM for this execution ID.
            resource = record['resource']
            work = self.scratch / ('execution-' + resource['resourceId'])
            base = 'run-' + resource['resourceId']
            record.update(state='STARTING', work=str(work), scratch=str(self.scratch),
                          terminal=str(self.state_dir / (base + '.result.json')),
                          guardianIdentity=str(self.state_dir / (base + '.guardian.json')),
                          qemuIdentity=str(self.state_dir / (base + '.qemu.json')),
                          createdMonotonic=time.monotonic() - ((time.time() * 1000 - (admission['normalDeadlineMs'] - 30000)) / 1000))
            self.save(record)
            work.mkdir(mode=0o700, exist_ok=False)
            data = self.kit.manifest
            request = {'schemaVersion': 1, 'bootId': resource['resourceId'], 'executionId': resource['executionId'],
                       'creationId': resource['creationId'], 'context': resource['context'], 'maxAdmissions': 1,
                       'ttlMs': 60000, 'createdAtEpochMs': admission['normalDeadlineMs'] - 30000,
                       'normalDeadlineEpochMs': admission['normalDeadlineMs'], 'cleanupDeadlineEpochMs': admission['cleanupDeadlineMs'],
                       'inputJson': value['inputJson'], 'inputSha256': admission['inputSha256'],
                       **{key: data[key] for key in ('sourceDigest', 'bundleSha256', 'bundleManifestSha256', 'capsuleImageId', 'runtime')}}
            durable_json(work / 'request.json', request)
            state_file = self.state_dir / ('record-' + resource['executionId'] + '.json')
            proc = subprocess.Popen([sys.executable, str(HERE / 'broker.py'), '_guardian', str(state_file),
                                     json.dumps(self.kit.fds), str(self.lock_fd)],
                                    pass_fds=(*self.kit.fds.values(), self.lock_fd), env=ENV, start_new_session=True,
                                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.processes[value['executionId']] = proc
        # Do not tie the guardian lifetime to an HTTP connection or this thread.
        deadline = record['createdMonotonic'] + 40
        while time.monotonic() < deadline:
            with self.lock:
                self.refresh(record)
                if record.get('terminalData'):
                    return self.completed(record)
                require(proc.poll() is None, 'GUARDIAN_INTERRUPTED')
            time.sleep(0.01)
        raise Rejected('VM_RESULT_DEADLINE')

    def completed(self, record):
        terminal = record['terminalData']
        require(terminal.get('failure') is None and terminal['response']['cleanupVerified'] is True, 'VM_EXECUTION_FAILED')
        return terminal['response']

    def proof(self, record):
        resource = record['resource']
        terminal = record.get('terminalData', {})
        verified = record.get('notStarted') is True or record.get('recoveryCleanupVerified') is True or terminal.get('response', {}).get('cleanupVerified') is True
        require(verified, 'CLEANUP_UNCONFIRMED')
        return {'cleanupVerified': True, 'resource': resource,
                'proof': {'kind': 'NOT_STARTED' if record.get('notStarted') else 'RETIRED',
                          **{key: resource[key] for key in ('executionId', 'creationId', 'resourceId')},
                          **{key: resource['context'][key] for key in ('hostId', 'brokerGeneration')},
                          'qemuAbsent': True, 'overlaysAbsent': True,
                          'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')}}

    def cleanup(self, value):
        require(set(value) == {'executionId', 'creationId', 'resourceId', 'context'}, 'CLEANUP_FIELDS')
        with self.lock:
            record = self.resolve(value, create=True)
            if record['state'] == 'PREPARED':
                record.update(state='CLOSED', notStarted=True)
                self.save(record)
            if record['state'] == 'CLOSED':
                try:
                    return self.proof(record)
                except Rejected:
                    return self.recover_retirement(record)
            path = Path(record['guardianIdentity'])
            if path.exists():
                own = parse_json(path.read_bytes())
                stop_pid(own['pid'], own['ticks'], signal.SIGTERM, own['bootId'])
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with self.lock:
                self.refresh(record)
                if record.get('terminalData'):
                    try:
                        return self.proof(record)
                    except Rejected:
                        return self.recover_retirement(record)
                if self.guardian_absent(record):
                    return self.recover_retirement(record)
                if path.exists():
                    own = parse_json(path.read_bytes())
                    stop_pid(own['pid'], own['ticks'], signal.SIGTERM, own['bootId'])
            time.sleep(0.02)
        raise Rejected('CLEANUP_UNCONFIRMED')

    def guardian_absent(self, record):
        path = Path(record['guardianIdentity'])
        if not path.exists():
            proc = self.processes.get(record['resource']['executionId'])
            return proc is None or proc.poll() is not None
        own = parse_json(path.read_bytes())
        fd = identified_pidfd(own['pid'], own['ticks'], own['bootId'])
        if fd is None:
            return True
        try:
            return exited(fd)
        finally:
            os.close(fd)

    def recover_retirement(self, record):
        """Recovery only retires identified resources; it never reconstructs input."""
        require(self.guardian_absent(record), 'GUARDIAN_STILL_ACTIVE')
        work = Path(record['work'])
        require(work.parent == self.scratch and work.name == 'execution-' + record['resource']['resourceId']
                and not work.is_symlink(), 'RECOVERY_PATH_REJECTED')
        # Covers death between QEMU spawn and publication of its PID record.
        # Match current UID, exact UUID argv and cwd, then signal through pidfd.
        for process in Path('/proc').iterdir():
            if not process.name.isdecimal():
                continue
            try:
                if process.stat().st_uid != os.getuid():
                    continue
                args = (process / 'cmdline').read_bytes().split(b'\x00')
                marker = record['resource']['resourceId'].encode()
                if not any(args[index:index + 2] == [b'-uuid', marker] for index in range(len(args) - 1)):
                    continue
                require((process / 'cwd').resolve(strict=True) == work, 'RECOVERY_PROCESS_CWD_MISMATCH')
                pid = int(process.name)
                ticks = start_ticks(pid)
                fd = identified_pidfd(pid, ticks)
                if fd is None:
                    continue
                try:
                    signal.pidfd_send_signal(fd, signal.SIGKILL)
                    with selectors.DefaultSelector() as selected:
                        selected.register(fd, selectors.EVENT_READ)
                        require(bool(selected.select(2)), 'RECOVERY_PROCESS_STILL_ACTIVE')
                finally:
                    os.close(fd)
            except (FileNotFoundError, ProcessLookupError):
                continue
        if work.exists():
            shutil.rmtree(work)
        require(not work.exists(), 'RECOVERY_OVERLAYS_PRESENT')
        terminal = record.get('terminalData')
        if terminal is None:
            terminal = {'state': 'CLOSED', 'failure': 'GUARDIAN_LOST_NO_REEXECUTION',
                        'qemuStarted': Path(record['qemuIdentity']).exists(),
                        'response': {'result': None, 'resource': record['resource'], 'cleanupVerified': True, 'vmEvidence': None}}
            durable_json(Path(record['terminal']), terminal)
        # A later cleanup observation never rewrites the original failure or its
        # measured timing and cannot promote a partial result into SUCCESS.
        record['state'], record['terminalData'], record['recoveryCleanupVerified'] = 'CLOSED', terminal, True
        self.save(record)
        return self.proof(record)

    def status(self, value):
        require(set(value) == {'executionId', 'creationId', 'resourceId', 'context'}, 'STATUS_FIELDS')
        with self.lock:
            record = self.resolve(value)
            terminal = record.get('terminalData', {})
            return {'state': record['state'], 'resource': record['resource'],
                    'cleanupVerified': record.get('notStarted') is True or record.get('recoveryCleanupVerified') is True or terminal.get('response', {}).get('cleanupVerified') is True,
                    'result': terminal.get('response') if terminal.get('failure') is None else None}

    def dispatch(self, path, value):
        require(isinstance(value, dict), 'BODY_OBJECT_REQUIRED')
        if path == '/inspect':
            require(not value, 'INSPECT_FIELDS')
            with self.lock:
                self.kit.check()
                return {'available': True, 'capacity': self.capacity(), 'context': self.context}
        if path == '/prepare':
            with self.lock:
                return self.prepare(value)
        if path == '/start':
            return self.start(value)
        if path == '/cleanup':
            return self.cleanup(value)
        if path == '/status':
            return self.status(value)
        if path == '/snapshot':
            require(not value, 'SNAPSHOT_FIELDS')
            with self.lock:
                rows = []
                for record in self.records.values():
                    self.refresh(record)
                    terminal = record.get('terminalData', {})
                    started = terminal.get('qemuStarted') is True or bool(record.get('qemuIdentity') and Path(record['qemuIdentity']).exists())
                    clean = record.get('notStarted') is True or record.get('recoveryCleanupVerified') is True or terminal.get('response', {}).get('cleanupVerified') is True
                    rows.append({**{key: record['resource'][key] for key in ('executionId', 'creationId', 'resourceId')},
                                 'state': record['state'], 'qemuStarted': started, 'cleanupVerified': clean})
                return {'schemaVersion': 1, 'context': self.context, 'records': rows,
                        'totals': {'qemuStarted': sum(row['qemuStarted'] for row in rows),
                                   'active': sum(row['state'] == 'STARTING' for row in rows),
                                   'uncertain': sum((row['state'] == 'CLOSED' and not row['cleanupVerified'])
                                                    or (row['state'] == 'STARTING' and self.guardian_absent(self.records[row['executionId']]))
                                                    for row in rows)}}
        raise Rejected('ENDPOINT_REJECTED')


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'
    def log_message(self, *_args):
        pass  # Never log request payload, code, private cases or raw errors.

    def do_POST(self):
        try:
            self.connection.settimeout(45)
            _pid, uid, _gid = struct.unpack('3i', self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            require(uid == os.getuid(), 'PEER_REJECTED')
            require(self.headers.get('Transfer-Encoding') is None
                    and len(self.headers.get_all('Content-Length', [])) == 1
                    and self.headers.get('Content-Type') == 'application/json', 'HTTP_HEADERS_REJECTED')
            length = self.headers.get('Content-Length', '')
            require(length.isdecimal() and 0 < int(length) <= BODY_LIMIT, 'HTTP_BODY_LIMIT')
            payload = self.rfile.read(int(length))
            require(len(payload) == int(length), 'HTTP_BODY_INCOMPLETE')
            result = self.server.broker.dispatch(self.path, parse_json(payload))
            raw, status_code = encoded(result), 200
            require(len(raw) <= RESULT_LIMIT, 'RESPONSE_LIMIT')
        except (Rejected, OSError, ValueError, KeyError, TypeError, RecursionError) as error:
            code = str(error) if isinstance(error, Rejected) else 'LOCAL_VM_BROKER_FAILED'
            raw, status_code = encoded({'error': code}), 409
        try:
            self.send_response(status_code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except OSError:
            pass


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    request_queue_size = 4


def main():
    os.umask(0o077)
    if len(sys.argv) > 1 and sys.argv[1] == '_watchdog':
        watchdog(int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]))
        return
    if len(sys.argv) > 1 and sys.argv[1] == '_qemu':
        qemu_wrapper(int(sys.argv[2]), sys.argv[3:])
        return
    if len(sys.argv) > 1 and sys.argv[1] == '_guardian':
        guardian(Path(sys.argv[2]), json.loads(sys.argv[3]), int(sys.argv[4]))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kit', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--socket', type=Path, required=True)
    parser.add_argument('--host-id', required=True)
    args = parser.parse_args()
    private_directory(args.socket.parent)
    broker = Broker(args.kit, args.manifest_sha256, args.state, args.scratch, args.host_id)
    if args.socket.exists() or args.socket.is_symlink():
        info = args.socket.lstat()
        # Exclusive inherited broker.lock was acquired first. Another live
        # broker/guardian prevents reaching this removal of our stale socket.
        require(stat.S_ISSOCK(info.st_mode) and info.st_uid == os.getuid(), 'SOCKET_IDENTITY_REJECTED')
        args.socket.unlink()
    with Server(str(args.socket), Handler) as server:
        server.broker = broker
        os.chmod(args.socket, 0o600)
        print(json.dumps({'status': 'ready', 'context': broker.context}), flush=True)
        try:
            server.serve_forever(poll_interval=0.1)
        finally:
            # Pending guardian holds its own lock and sealed FD references.
            args.socket.unlink()


if __name__ == '__main__':
    try:
        main()
    except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        raise SystemExit('LOCAL_VM_OPERATION_FAILED')
