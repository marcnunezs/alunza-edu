"""Local protocol and Linux kernel primitives; never starts QEMU or Docker."""
import copy
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import selectors
import signal
import socket
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'infra/runner/linux-vm'
sys.path.insert(0, str(SOURCE))
import protocol


def context():
    return {'provider': 'local-vm', 'image': 'sha256:' + 'a' * 64, 'runnerVersion': 'imp-03-quickjs.13',
            'hostId': '10000000-0000-4000-8000-000000000001', 'kitManifestSha256': 'b' * 64,
            'brokerVersion': 'local-vm-broker-v1', 'guestSha256': 'c' * 64,
            'brokerGeneration': '10000000-0000-4000-8000-000000000002'}


def input_data():
    return {'executionId': '10000000-0000-4000-8000-000000000003', 'requestId': 'local-http',
            'exerciseVersionId': 'exercise-version', 'testsVersion': 'tests-v1', 'entrypoint': 'solve',
            'code': 'module.exports.solve=(a,b)=>a+b;', 'mode': 'SUBMIT',
            'tests': [{'id': 'visible', 'visibility': 'visible', 'args': [1, 2], 'expected': 3},
                      {'id': 'private', 'visibility': 'hidden', 'args': [10, 20], 'expected': 30}]}


def result_data():
    return {'executionId': input_data()['executionId'], 'runnerVersion': 'imp-03-quickjs.13',
            'diagnosisCode': 'SUCCESS', 'terminationReason': 'COMPLETED', 'infrastructureStatus': 'OK',
            'allRequiredPassed': True, 'visibleTestResults': [{'id': 'visible', 'passed': True, 'stdout': '', 'stderr': ''}],
            'privateTestResults': [{'id': 'private', 'passed': True, 'stdout': 'private output', 'stderr': ''}],
            'hiddenRequiredCount': 1, 'outputTruncated': False, 'outputBytes': 14, 'runtimeMs': 200,
            'lifecycleMs': 500, 'evidence': {'provider': 'docker', 'image': context()['image'], 'cleanupVerified': True}}


class ProtocolTests(unittest.TestCase):
    def test_duplicate_nonfinite_oversize_and_extras_rejected(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'\xff'):
            with self.assertRaises(protocol.Rejected):
                protocol.parse_json(raw)
        with self.assertRaises(protocol.Rejected):
            protocol.parse_json(b'{}', 1)
        bad = context()
        bad['limits'] = {'runtimeMs': 6000}
        with self.assertRaises(protocol.Rejected):
            protocol.context(bad)

    def test_input_digest_exact_utf8_and_no_authority_fields(self):
        raw = json.dumps(input_data(), ensure_ascii=False)
        digest = hashlib.sha256(raw.encode()).hexdigest()
        self.assertEqual(protocol.input_value(raw, input_data()['executionId'], digest), input_data())
        with self.assertRaises(protocol.Rejected):
            protocol.input_value(raw + ' ', input_data()['executionId'], digest)
        changed = input_data()
        changed['limits'] = {'runtimeMs': 6000}
        raw = json.dumps(changed)
        with self.assertRaises(protocol.Rejected):
            protocol.input_value(raw, changed['executionId'], hashlib.sha256(raw.encode()).hexdigest())

    def test_result_correlated_and_hidden_output_remains_only_private(self):
        value = protocol.result_value(result_data(), input_data(), context())
        self.assertEqual(value['privateTestResults'][0]['stdout'], 'private output')
        self.assertEqual(value['visibleTestResults'][0]['stdout'], '')
        for mutate in (lambda row: row.update(executionId=context()['hostId']),
                       lambda row: row.update(privateTestResults=[]),
                       lambda row: row.update(runtimeMs=3000),
                       lambda row: row['privateTestResults'][0].update(passed=False),
                       lambda row: row['evidence'].update(image='sha256:' + 'd' * 64)):
            candidate = result_data()
            mutate(candidate)
            with self.assertRaises(protocol.Rejected):
                protocol.result_value(candidate, input_data(), context())

    def test_failed_actual_overrun_is_not_clipped_or_reclassified(self):
        value = result_data()
        value.update(diagnosisCode='TIMEOUT', terminationReason='EXECUTION_DEADLINE',
                     allRequiredPassed=False, runtimeMs=3017)
        projected = protocol.result_value(value, input_data(), context())
        self.assertEqual(projected['runtimeMs'], 3017)
        self.assertEqual(projected['diagnosisCode'], 'TIMEOUT')


@unittest.skipUnless(sys.platform == 'linux', 'Linux memfd/pidfd/UDS primitives required')
class LinuxBrokerTests(unittest.TestCase):
    def setUp(self):
        import broker
        self.module = broker
        self.temporary = tempfile.TemporaryDirectory(prefix='alunza-vm-unit-')
        self.root = Path(self.temporary.name)
        self.kit = self.root / 'kit'
        self.kit.mkdir(mode=0o700)
        self.state, self.scratch = self.root / 'state', self.root / 'scratch'
        self.state.mkdir(mode=0o700)
        self.scratch.mkdir(mode=0o700)
        manifest = {'schemaVersion': 1, 'scope': 'LOCAL_VM_API', 'runnerVersion': 'imp-03-quickjs.13',
                    'virginBase': 'supplied-declaration-not-forensic-proof', 'capsuleImageId': context()['image'],
                    'guestEntrypointSha256': context()['guestSha256'], 'files': {}}
        for index, name in enumerate(protocol.ARTIFACTS):
            raw = bytes([index + 1]) * 8192
            (self.kit / name).write_bytes(raw)
            manifest['files'][name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        raw = protocol.encoded(manifest)
        (self.kit / 'guest-manifest.json').write_bytes(raw)
        self.expected = hashlib.sha256(raw).hexdigest()
        self.broker = broker.Broker(self.kit, self.expected, self.state, self.scratch, context()['hostId'])

    def tearDown(self):
        self.broker.kit.close()
        os.close(self.broker.lock_fd)
        self.temporary.cleanup()

    def prepare_request(self):
        raw = json.dumps(input_data())
        now = int(time.time() * 1000)
        return {'executionId': input_data()['executionId'], 'creationId': '10000000-0000-4000-8000-000000000004',
                'context': self.broker.context, 'normalDeadlineMs': now + 30000, 'cleanupDeadlineMs': now + 40000,
                'inputSha256': hashlib.sha256(raw.encode()).hexdigest()}

    def cleanup_request(self, prepared, resource=None):
        return {key: prepared[key] for key in ('executionId', 'creationId', 'context')} | {'resourceId': resource}

    def test_sealed_copies_reject_write_resize_and_survive_source_replacement(self):
        for name, fd in self.broker.kit.fds.items():
            original = os.pread(fd, 16, 0)
            for change in (lambda: os.pwrite(fd, b'changed', 0), lambda: os.ftruncate(fd, 1), lambda: os.ftruncate(fd, 65536)):
                with self.assertRaises(PermissionError):
                    change()
            (self.kit / name).write_bytes(b'changed source')
            self.assertEqual(os.pread(fd, 16, 0), original)
        self.broker.kit.check()

    def test_inherited_memfd_reads_without_broker_pid_path(self):
        fd = self.broker.kit.fds['root.img']
        # Trusted fixed Python helper, not a student program; no VM or QEMU.
        completed = subprocess.run([sys.executable, '-c', 'import sys; print(len(open(sys.argv[1],"rb").read()))',
                                    '/proc/self/fd/' + str(fd)], pass_fds=(fd,), capture_output=True, text=True, check=True)
        self.assertEqual(completed.stdout.strip(), '8192')

    def test_prepare_is_idempotent_no_vm_and_global_single_admission(self):
        request = self.prepare_request()
        with patch.object(self.module.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
            first = self.broker.dispatch('/prepare', request)
            self.assertEqual(self.broker.dispatch('/prepare', request), first)
            second = {**request, 'executionId': context()['hostId']}
            with self.assertRaises(protocol.Rejected):
                self.broker.dispatch('/prepare', second)
        self.assertEqual(self.broker.dispatch('/snapshot', {})['totals']['qemuStarted'], 0)

    def test_inspection_keeps_identity_and_distinguishes_busy_from_uncertainty(self):
        expected = self.broker.context
        self.assertEqual(self.broker.dispatch('/inspect', {}),
                         {'available': True, 'capacity': 'READY', 'context': expected})
        request = self.prepare_request()
        reply = self.broker.dispatch('/prepare', request)
        with patch.object(self.module.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
            self.assertEqual(self.broker.dispatch('/inspect', {})['capacity'], 'BUSY')
            record = self.broker.records[request['executionId']]
            record['prepared']['normalDeadlineMs'] = 0
            inspected = self.broker.dispatch('/inspect', {})
            self.assertEqual(inspected, {'available': True, 'capacity': 'UNCERTAIN', 'context': expected})
            self.assertEqual(record['state'], 'PREPARED')
            self.broker.dispatch('/cleanup', self.cleanup_request(request, reply['resourceId']))
            self.assertEqual(self.broker.dispatch('/inspect', {})['capacity'], 'READY')

    def test_missing_guardian_or_unverified_retirement_never_becomes_ready(self):
        request = self.prepare_request()
        self.broker.dispatch('/prepare', request)
        record = self.broker.records[request['executionId']]
        record['state'] = 'STARTING'
        with patch.object(self.broker, 'guardian_absent', return_value=False):
            self.assertEqual(self.broker.dispatch('/inspect', {})['capacity'], 'BUSY')
        with patch.object(self.broker, 'guardian_absent', return_value=True):
            self.assertEqual(self.broker.dispatch('/inspect', {})['capacity'], 'UNCERTAIN')
        record['state'] = 'CLOSED'
        self.assertEqual(self.broker.dispatch('/inspect', {})['capacity'], 'UNCERTAIN')
        record['recoveryCleanupVerified'] = True
        self.assertEqual(self.broker.dispatch('/inspect', {})['capacity'], 'READY')

    def test_two_concurrent_preparations_have_one_winner_without_vm(self):
        request = self.prepare_request()
        second = {**request, 'executionId': context()['hostId']}
        gate = threading.Barrier(2)
        results = []
        def attempt(value):
            gate.wait()
            try:
                results.append(self.broker.dispatch('/prepare', value))
            except protocol.Rejected as error:
                results.append(str(error))
        with patch.object(self.module.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
            threads = [threading.Thread(target=attempt, args=(value,)) for value in (request, second)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=5)
                self.assertFalse(thread.is_alive())
        self.assertEqual(sum(isinstance(value, dict) for value in results), 1)
        self.assertEqual(results.count('BROKER_BUSY_OR_UNCERTAIN'), 1)
        self.assertEqual(len(self.broker.records), 1)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_fractional_deadlines_rejected_before_reservation_or_vm(self):
        request = self.prepare_request()
        request['normalDeadlineMs'] -= 0.25
        request['cleanupDeadlineMs'] -= 0.25
        # The +10000 relation remains valid: rejection must match the guest's
        # safe-integer admission contract, not a different deadline constraint.
        with patch.object(self.module.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
            with self.assertRaisesRegex(protocol.Rejected, '^DEADLINE_REJECTED$'):
                self.broker.dispatch('/prepare', request)
        self.assertEqual(self.broker.records, {})
        self.assertEqual(list(self.state.glob('record-*.json')), [])
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_cleanup_tombstone_blocks_late_prepare_and_start_after_restart_generation(self):
        prepared = self.prepare_request()
        request = self.cleanup_request(prepared)
        result = self.broker.dispatch('/cleanup', request)
        self.assertTrue(result['cleanupVerified'])
        self.assertEqual(result['proof']['kind'], 'NOT_STARTED')
        with self.assertRaises(protocol.Rejected):
            self.broker.dispatch('/prepare', prepared)
        with self.assertRaises(protocol.Rejected):
            self.broker.dispatch('/start', {**request, 'inputJson': json.dumps(input_data())})
        self.assertEqual(self.broker.dispatch('/status', request)['state'], 'CLOSED')

    def test_prepared_cleanup_correlates_resource_and_rejects_other_creation(self):
        prepared = self.prepare_request()
        reply = self.broker.dispatch('/prepare', prepared)
        request = self.cleanup_request(prepared, reply['resourceId'])
        with self.assertRaises(protocol.Rejected):
            self.broker.dispatch('/cleanup', {**request, 'creationId': context()['hostId']})
        result = self.broker.dispatch('/cleanup', request)
        self.assertEqual(result['resource']['resourceId'], reply['resourceId'])
        self.assertEqual(result['proof']['brokerGeneration'], prepared['context']['brokerGeneration'])

    def test_old_generation_cleanup_only_same_installation_and_never_start(self):
        prepared = self.prepare_request()
        prepared['context'] = {**prepared['context'], 'brokerGeneration': context()['brokerGeneration']}
        request = self.cleanup_request(prepared)
        self.assertTrue(self.broker.dispatch('/cleanup', request)['cleanupVerified'])
        other = self.cleanup_request(self.prepare_request())
        other['executionId'] = context()['hostId']
        other['context'] = {**other['context'], 'image': 'sha256:' + 'e' * 64}
        with self.assertRaises(protocol.Rejected):
            self.broker.dispatch('/cleanup', other)

    def test_input_not_delivered_for_digest_context_or_deadline_rejection(self):
        prepared = self.prepare_request()
        reply = self.broker.dispatch('/prepare', prepared)
        request = self.cleanup_request(prepared, reply['resourceId'])
        with patch.object(self.module.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
            for change in ({'inputJson': '{}'}, {'inputJson': json.dumps(input_data()), 'context': context()}):
                with self.assertRaises(protocol.Rejected):
                    self.broker.dispatch('/start', {**request, **change})
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_qemu_arguments_preserve_limits_no_nic_and_unique_disk_identity(self):
        args = self.module.vm_args(self.broker.kit.fds, context()['hostId'])
        for flag, expected in (('-smp', '1'), ('-m', '2048'), ('-nic', 'none'), ('-accel', 'kvm')):
            self.assertEqual(args[args.index(flag) + 1], expected)
        self.assertIn('root=/dev/vda ', args[args.index('-append') + 1])
        self.assertIn('nvme-ns,bus=ctrl,drive=store,nsid=1', args)
        self.assertNotIn('-virtfs', args)
        self.assertNotIn('-initrd', args)

    def test_receipt_requires_identity_ready_single_result_and_cleanup(self):
        admitted = {'bootId': context()['hostId'], 'executionId': input_data()['executionId'],
                    'creationId': context()['brokerGeneration'], 'context': context(), 'sourceDigest': 'f' * 64,
                    'runtime': {'runtime': 'crun', 'runtimeVersion': '1.31'}, 'inputJson': json.dumps(input_data())}
        admitted['inputSha256'] = hashlib.sha256(admitted['inputJson'].encode()).hexdigest()
        receipt = self.module.Receipt(admitted)
        def line(value):
            return self.module.PREFIX + protocol.encoded({key: admitted[key] for key in ('bootId', 'executionId', 'creationId')} | value)
        with self.assertRaises(protocol.Rejected):
            receipt.accept(line({'event': 'result', 'admissions': 1, 'result': result_data()}))
        receipt.accept(line({'event': 'ready', 'sourceDigest': 'f' * 64, 'runtime': 'crun', 'runtimeVersion': '1.31',
                             'runnerVersion': 'imp-03-quickjs.13', 'strategy': 'cold', 'daemonInEnvelope': True,
                             'supervisorInEnvelope': True, 'envelope': {'cpuCount': 1, 'memoryMax': '2147483648',
                             'swapMax': '0', 'cpuMax': '100000 100000', 'selfGroup': '0::/alunzasingleexecutor.slice/guest.service',
                             'cgroupVersion': '2', 'cgroupDriver': 'systemd'}}))
        receipt.accept(line({'event': 'result', 'admissions': 1, 'result': result_data()}))
        self.assertFalse(receipt.clean)
        with self.assertRaises(protocol.Rejected):
            receipt.accept(line({'event': 'result', 'admissions': 1, 'result': result_data()}))
        receipt.accept(line({'event': 'clean', 'containers': 0}))
        self.assertTrue(receipt.clean)

    def test_socket_http_is_private_bounded_and_does_not_log_payload(self):
        path = self.root / 'private.sock'
        server = self.module.Server(str(path), self.module.Handler)
        server.broker = self.broker
        worker = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01})
        worker.start()
        class Connection(http.client.HTTPConnection):
            def connect(self):
                self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self.sock.connect(str(path))
        try:
            with patch.object(self.module.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
                client = Connection('localhost')
                client.request('POST', '/inspect', body=b'{}', headers={'Content-Type': 'application/json'})
                response = client.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())['context'], self.broker.context)
                client.close()
                client = Connection('localhost')
                client.request('POST', '/inspect', body=b'{"secret":"DO_NOT_ECHO"}', headers={'Content-Type': 'application/json'})
                response = client.getresponse()
                self.assertEqual(response.status, 409)
                body = response.read()
                self.assertEqual(json.loads(body), {'error': 'INSPECT_FIELDS'})
                self.assertNotIn(b'DO_NOT_ECHO', body)
                client.close()
        finally:
            server.shutdown()
            worker.join(2)
            server.server_close()

    def test_capture_real_pipe_with_fragmented_ready_result_and_clean_frames(self):
        admitted = {'bootId': context()['hostId'], 'executionId': input_data()['executionId'],
                    'creationId': context()['brokerGeneration'], 'context': context(), 'sourceDigest': 'f' * 64,
                    'runtime': {'runtime': 'crun', 'runtimeVersion': '1.31'}, 'inputJson': json.dumps(input_data())}
        admitted['inputSha256'] = hashlib.sha256(admitted['inputJson'].encode()).hexdigest()
        correlation = {key: admitted[key] for key in ('bootId', 'executionId', 'creationId')}
        ready = {'event': 'ready', 'sourceDigest': 'f' * 64, 'runtime': 'crun', 'runtimeVersion': '1.31',
                 'runnerVersion': 'imp-03-quickjs.13', 'strategy': 'cold', 'daemonInEnvelope': True,
                 'supervisorInEnvelope': True, 'envelope': {'cpuCount': 1, 'memoryMax': '2147483648',
                 'swapMax': '0', 'cpuMax': '100000 100000', 'selfGroup': '0::/alunzasingleexecutor.slice/guest.service',
                 'cgroupVersion': '2', 'cgroupDriver': 'systemd'}}
        frames = b'boot diagnostic\r\n' + b''.join(self.module.PREFIX + protocol.encoded(correlation | value) + b'\r\n'
                   for value in (ready, {'event': 'result', 'admissions': 1, 'result': result_data()},
                                 {'event': 'clean', 'containers': 0}))
        read_fd, write_fd = os.pipe()
        def producer():
            try:
                for offset in range(0, len(frames), 37):
                    os.write(write_fd, frames[offset:offset + 37])
            finally:
                os.close(write_fd)
        writer = threading.Thread(target=producer)
        receipt = self.module.Receipt(admitted)
        with os.fdopen(read_fd, 'rb', buffering=0) as stream:
            writer.start()
            try:
                self.module.capture(SimpleNamespace(stdout=stream), receipt, time.monotonic() + 3, time.monotonic() + 4)
            finally:
                writer.join(2)
        self.assertTrue(receipt.ready)
        self.assertTrue(receipt.clean)
        self.assertEqual(receipt.result, result_data())
        self.assertEqual(receipt.envelope, ready['envelope'])

    def test_watchdog_uses_pidfd_to_retire_only_own_inert_process_at_deadline(self):
        proc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'], start_new_session=True)
        fd = os.pidfd_open(proc.pid)
        try:
            watch = subprocess.Popen([sys.executable, str(SOURCE / 'broker.py'), '_watchdog', str(fd),
                                      str(proc.pid), str(time.monotonic() + 0.15)], pass_fds=(fd,))
            watch.wait(timeout=3)
            proc.wait(timeout=3)
            self.assertEqual(proc.returncode, -signal.SIGKILL)
        finally:
            os.close(fd)
            if proc.poll() is None:
                proc.kill()
            proc.wait()

    def test_guardian_parent_death_kills_trusted_inert_exec_wrapper(self):
        # This fixed sleeping helper validates PDEATHSIG; no student source and
        # no QEMU, container, network or fixture execution occurs on the host.
        marker = self.root / 'inert-exec-ready'
        script = ('import os,subprocess,sys,time; p=subprocess.Popen([sys.executable,sys.argv[1],"_qemu",str(os.getpid()),'
                  'sys.executable,"-c","import pathlib,sys,time; pathlib.Path(sys.argv[1]).write_text(\'ready\'); time.sleep(30)",sys.argv[2]]); print(p.pid,flush=True); time.sleep(30)')
        parent = subprocess.Popen([sys.executable, '-c', script, str(SOURCE / 'broker.py'), str(marker)],
                                  stdout=subprocess.PIPE, text=True, start_new_session=True)
        child = int(parent.stdout.readline().strip())
        fd = os.pidfd_open(child)
        try:
            deadline = time.monotonic() + 3
            while not marker.exists() and time.monotonic() < deadline:
                self.assertFalse(self.module.exited(fd), 'wrapper exited before trusted exec handshake')
                time.sleep(0.01)
            self.assertTrue(marker.exists(), 'trusted inert executable never started')
            self.assertFalse(self.module.exited(fd))
            parent.kill()
            parent.wait(timeout=2)
            with selectors.DefaultSelector() as selected:
                selected.register(fd, selectors.EVENT_READ)
                self.assertTrue(selected.select(3), 'inert child survived guardian death')
        finally:
            if not self.module.exited(fd):
                signal.pidfd_send_signal(fd, signal.SIGKILL)
            os.close(fd)
            if parent.poll() is None:
                parent.kill()
            parent.wait()
            parent.stdout.close()

    def test_recovery_cleans_only_owned_scratch_without_reexecution_or_success(self):
        prepared = self.prepare_request()
        response = self.broker.prepare(prepared)
        record = self.broker.records[prepared['executionId']]
        work = self.scratch / ('execution-' + response['resourceId'])
        work.mkdir(mode=0o700)
        (work / 'request.json').write_text('PRIVATE_INPUT')
        base = 'run-' + response['resourceId']
        record.update(state='STARTING', work=str(work), scratch=str(self.scratch),
                      terminal=str(self.state / (base + '.result.json')),
                      guardianIdentity=str(self.state / (base + '.guardian.json')),
                      qemuIdentity=str(self.state / (base + '.qemu.json')))
        self.broker.save(record)
        neighbor = self.scratch / 'unrelated'
        neighbor.mkdir()
        with patch.object(self.module.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
            proof = self.broker.cleanup(self.cleanup_request(prepared, response['resourceId']))
        self.assertTrue(proof['cleanupVerified'])
        self.assertFalse(work.exists())
        self.assertTrue(neighbor.exists())
        status = self.broker.status(self.cleanup_request(prepared, response['resourceId']))
        self.assertEqual(status['state'], 'CLOSED')
        self.assertIsNone(status['result'])
        with self.assertRaises(protocol.Rejected):
            self.broker.prepare(prepared)

    def test_record_tombstone_survives_broker_restart_and_keeps_old_generation(self):
        prepared = self.prepare_request()
        request = self.cleanup_request(prepared)
        first = self.broker.cleanup(request)
        self.broker.kit.close()
        os.close(self.broker.lock_fd)
        self.broker = self.module.Broker(self.kit, self.expected, self.state, self.scratch, context()['hostId'])
        self.assertNotEqual(self.broker.context['brokerGeneration'], first['resource']['context']['brokerGeneration'])
        repeated = self.broker.cleanup(request)
        self.assertEqual(repeated['resource'], first['resource'])
        with self.assertRaises(protocol.Rejected):
            self.broker.prepare({**prepared, 'context': self.broker.context})


if __name__ == '__main__':
    unittest.main()
