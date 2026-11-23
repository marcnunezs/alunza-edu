"""Private local VM protocol. No student program is evaluated by this module."""
import hashlib
import json
import math
import os
import re
import stat
import tempfile
from pathlib import Path

VERSION = 'local-vm-broker-v1'
BODY_LIMIT = 2097152
INPUT_LIMIT = 1572864
RESULT_LIMIT = 1048576
ARTIFACTS = ('kernel', 'root.img', 'docker-store.img')
CONTEXT_FIELDS = {'provider', 'image', 'runnerVersion', 'hostId', 'kitManifestSha256',
                  'brokerVersion', 'guestSha256', 'brokerGeneration'}
HEX = re.compile(r'[a-f0-9]{64}\Z')
UUID = re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z')


class Rejected(ValueError):
    pass


def require(value, code):
    if not value:
        raise Rejected(code)


def uuid_value(value):
    return isinstance(value, str) and UUID.fullmatch(value) is not None


def hash_value(value):
    return isinstance(value, str) and HEX.fullmatch(value) is not None


def number(value, maximum=60000):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def parse_json(raw, maximum=BODY_LIMIT):
    require(isinstance(raw, bytes) and len(raw) <= maximum, 'FRAME_TOO_LARGE')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(Rejected('NONFINITE_JSON')))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise Rejected('INVALID_JSON') from error


def digest_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def durable_json(path, value):
    """Replace only our private state file, fsync data and containing directory."""
    raw = encoded(value)
    fd, temporary = tempfile.mkstemp(prefix='.state-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def private_directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
            'PRIVATE_DIRECTORY_REQUIRED')
    return path.resolve(strict=True)


def context(value):
    require(isinstance(value, dict) and set(value) == CONTEXT_FIELDS, 'CONTEXT_FIELDS')
    require(value['provider'] == 'local-vm' and value['brokerVersion'] == VERSION
            and value['runnerVersion'] == 'imp-03-quickjs.13'
            and all(uuid_value(value[key]) for key in ('hostId', 'brokerGeneration'))
            and all(hash_value(value[key]) for key in ('kitManifestSha256', 'guestSha256'))
            and isinstance(value['image'], str) and re.fullmatch(r'sha256:[a-f0-9]{64}', value['image']),
            'CONTEXT_REJECTED')
    return value


def same_installation(left, right):
    context(left)
    context(right)
    return all(left[key] == right[key] for key in CONTEXT_FIELDS - {'brokerGeneration'})


def identity(value, *, resource=True):
    require(isinstance(value, dict) and uuid_value(value.get('executionId'))
            and uuid_value(value.get('creationId')), 'IDENTITY_REJECTED')
    if resource:
        require(value.get('resourceId') is None or uuid_value(value['resourceId']), 'RESOURCE_REJECTED')
    context(value.get('context'))
    return value


def input_value(raw, expected_id, expected_digest):
    require(isinstance(raw, str), 'INPUT_REQUIRED')
    data = raw.encode('utf-8')
    require(len(data) <= INPUT_LIMIT and hashlib.sha256(data).hexdigest() == expected_digest, 'INPUT_DIGEST_MISMATCH')
    value = parse_json(data, INPUT_LIMIT)
    require(isinstance(value, dict) and set(value) == {'executionId', 'requestId', 'exerciseVersionId',
            'testsVersion', 'mode', 'entrypoint', 'code', 'tests'}, 'INPUT_FIELDS')
    require(value['executionId'] == expected_id and value['entrypoint'] == 'solve'
            and value['mode'] in ('RUN', 'SUBMIT') and isinstance(value['code'], str)
            and len(value['code'].encode('utf-8')) <= 65536, 'INPUT_REJECTED')
    for key in ('requestId', 'exerciseVersionId', 'testsVersion'):
        require(isinstance(value[key], str) and 1 <= len(value[key]) <= 100, 'INPUT_ID_REJECTED')
    tests = value['tests']
    require(isinstance(tests, list) and 1 <= len(tests) <= 8, 'TESTS_REJECTED')
    ids = set()
    for test in tests:
        require(isinstance(test, dict) and set(test) == {'id', 'visibility', 'args', 'expected'}, 'TEST_FIELDS')
        require(isinstance(test['id'], str) and 1 <= len(test['id']) <= 100 and test['id'] not in ids
                and test['visibility'] in ('visible', 'hidden') and isinstance(test['args'], list)
                and len(encoded(test['args'])) <= 65536, 'TEST_REJECTED')
        ids.add(test['id'])
    require(value['mode'] == 'SUBMIT' or any(test['visibility'] == 'visible' for test in tests), 'VISIBLE_TEST_REQUIRED')
    return value


def result_value(value, input_data, admitted_context):
    """Host correlation/shape gate; the Node adapter also validates full runtime evidence."""
    fields = {'executionId', 'runnerVersion', 'diagnosisCode', 'terminationReason', 'infrastructureStatus',
              'allRequiredPassed', 'visibleTestResults', 'privateTestResults', 'hiddenRequiredCount',
              'outputTruncated', 'outputBytes', 'runtimeMs', 'lifecycleMs', 'evidence'}
    require(isinstance(value, dict) and set(value) == fields and len(encoded(value)) <= RESULT_LIMIT, 'RESULT_FIELDS')
    require(value['executionId'] == input_data['executionId'] and value['runnerVersion'] == admitted_context['runnerVersion'], 'RESULT_IDENTITY')
    require(value['diagnosisCode'] in ('SUCCESS', 'SYNTAX_ERROR', 'RUNTIME_ERROR', 'FAILED_TEST', 'TIMEOUT', 'UNKNOWN')
            and value['terminationReason'] in ('COMPLETED', 'STUDENT_SYNTAX', 'STUDENT_EXCEPTION', 'ASSERTION_FAILED',
            'EXECUTION_DEADLINE', 'MEMORY_LIMIT', 'OUTPUT_LIMIT', 'RETURN_LIMIT', 'PROTOCOL_INVALID',
            'RUNNER_FAILURE', 'PROVIDER_FAILURE', 'CAPABILITY_GAP', 'CANCELLED')
            and value['infrastructureStatus'] in ('OK', 'FAILED'), 'RESULT_ENUM')
    require(type(value['allRequiredPassed']) is bool and type(value['outputTruncated']) is bool
            and number(value['runtimeMs']) and number(value['lifecycleMs'])
            and type(value['outputBytes']) is int and 0 <= value['outputBytes'] <= 65536, 'RESULT_LIMITS')
    selected = [row for row in input_data['tests'] if input_data['mode'] == 'SUBMIT' or row['visibility'] == 'visible']
    require(type(value['hiddenRequiredCount']) is int and value['hiddenRequiredCount'] == sum(row['visibility'] == 'hidden' for row in selected), 'RESULT_HIDDEN_COUNT')
    output_bytes = 0
    completed = 0
    for visibility, field in (('visible', 'visibleTestResults'), ('hidden', 'privateTestResults')):
        rows = value[field]
        expected = [test['id'] for test in selected if test['visibility'] == visibility]
        require(isinstance(rows, list) and len(rows) <= len(expected), 'RESULT_CASE_COUNT')
        for index, row in enumerate(rows):
            require(isinstance(row, dict) and set(row) == {'id', 'passed', 'stdout', 'stderr'}
                    and row['id'] == expected[index] and type(row['passed']) is bool
                    and isinstance(row['stdout'], str) and isinstance(row['stderr'], str), 'RESULT_CASE')
            output_bytes += len(row['stdout'].encode('utf-8')) + len(row['stderr'].encode('utf-8'))
        completed += len(rows)
    # UTF-8 replacement for a cut multibyte character can make displayed bytes
    # differ from captured raw bytes. The producer's raw counter is authoritative.
    require(output_bytes <= 65536 + 6 * len(selected), 'RESULT_DISPLAY_OUTPUT')
    evidence = value['evidence']
    require(isinstance(evidence, dict) and evidence.get('provider') == 'docker'
            and evidence.get('image') in (None, admitted_context['image'])
            and type(evidence.get('cleanupVerified')) is bool, 'RESULT_EVIDENCE')
    require(value['diagnosisCode'] != 'SUCCESS' or (value['allRequiredPassed'] is True
            and value['terminationReason'] == 'COMPLETED' and value['infrastructureStatus'] == 'OK'
            and value['runtimeMs'] < 3000 and completed == len(selected)
            and evidence['image'] == admitted_context['image'] and evidence['cleanupVerified'] is True
            and all(row['passed'] for key in ('visibleTestResults', 'privateTestResults') for row in value[key])), 'INCOMPLETE_SUCCESS')
    return value
