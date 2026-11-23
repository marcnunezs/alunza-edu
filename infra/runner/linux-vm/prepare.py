"""Offline copy of a verified virgin .13 kit, installing only the API transport.

The runner archive, capsule store and kernel are preserved byte-for-byte.
No mount, guest boot, host package installation or live-host export is performed.
"""
import argparse
import json
import shutil
import stat
import subprocess
import tarfile
from pathlib import Path
from protocol import ARTIFACTS, Rejected, digest_file, hash_value, require

HERE = Path(__file__).resolve().parent


def prepare(source, expected, output):
    source = source.resolve(strict=True)
    require(hash_value(expected) and digest_file(source / 'guest-manifest.json') == expected, 'SOURCE_MANIFEST_MISMATCH')
    data = json.loads((source / 'guest-manifest.json').read_text())
    require(data.get('schemaVersion') == 2 and data.get('scope') == 'LOCAL_SINGLE_EXECUTION'
            and data.get('virginBase') == 'supplied-declaration-not-forensic-proof'
            and set(data.get('files', {})) == set(ARTIFACTS), 'VIRGIN_KIT_REQUIRED')
    for name in ARTIFACTS:
        path, item = source / name, data['files'][name]
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                and info.st_size == item['bytes'] and digest_file(path) == item['sha256'], 'SOURCE_FILE_MISMATCH')
    require(shutil.which('debugfs'), 'DEBUGFS_REQUIRED')
    output.mkdir(mode=0o700, exist_ok=False)
    for name in ARTIFACTS:
        shutil.copyfile(source / name, output / name)
    staging = output / 'transport-install'
    staging.mkdir(mode=0o700)
    commands = []
    for name in ('guest.cjs', 'protocol.cjs'):
        shutil.copyfile(HERE / name, staging / name)
        commands += ['rm /opt/alunza-single/' + name, 'write ' + name + ' /opt/alunza-single/' + name]
    (staging / 'commands').write_text('\n'.join(commands) + '\n')
    subprocess.run(['debugfs', '-w', '-f', 'commands', str((output / 'root.img').resolve())],
                   cwd=staging, check=True, capture_output=True, timeout=120)
    for name in ('guest.cjs', 'protocol.cjs'):
        destination = staging / ('verified-' + name)
        subprocess.run(['debugfs', '-R', 'dump /opt/alunza-single/' + name + ' ' + destination.name,
                        str((output / 'root.img').resolve())], cwd=staging, check=True, capture_output=True, timeout=120)
        require(destination.is_file() and digest_file(destination) == digest_file(HERE / name), 'TRANSPORT_INSTALL_MISMATCH')
    # Verify the installed bundle identity; never rebuild the accepted runner.
    for name, key in (('runner.tar.gz', 'bundleSha256'), ('runner-bundle.json', 'bundleManifestSha256')):
        destination = staging / name
        subprocess.run(['debugfs', '-R', 'dump /opt/alunza-single/' + name + ' ' + name,
                        str((output / 'root.img').resolve())], cwd=staging, check=True, capture_output=True, timeout=120)
        require(destination.is_file() and digest_file(destination) == data[key], 'FROZEN_BUNDLE_MISMATCH')
    bundle = json.loads((staging / 'runner-bundle.json').read_text())
    require(bundle['sourceDigest'] == data['sourceDigest'], 'SOURCE_DIGEST_MISMATCH')
    with tarfile.open(staging / 'runner.tar.gz', 'r:gz') as archive:
        member = archive.getmember('packages/runner/dist/index.js')
        require(member.isfile() and member.size < 1048576, 'RUNNER_ENTRY_REJECTED')
        entrypoint = archive.extractfile(member).read().decode('utf-8')
        require("export const RUNNER_VERSION = 'imp-03-quickjs.13';" in entrypoint, 'RUNNER_13_REQUIRED')
    require(all(digest_file(source / name) == data['files'][name]['sha256'] for name in ARTIFACTS), 'SOURCE_CHANGED')
    result = {**data, 'schemaVersion': 1, 'scope': 'LOCAL_VM_API', 'runnerVersion': 'imp-03-quickjs.13',
              'sourceKitManifestSha256': expected, 'guestEntrypointSha256': digest_file(HERE / 'guest.cjs'),
              'guestProtocolSha256': digest_file(HERE / 'protocol.cjs'),
              'guestSupportFiles': {'/opt/alunza-single/protocol.cjs': digest_file(HERE / 'protocol.cjs')},
              'files': {name: {'bytes': (output / name).stat().st_size, 'sha256': digest_file(output / name)} for name in ARTIFACTS}}
    (output / 'guest-manifest.json').write_text(json.dumps(result, sort_keys=True, indent=2) + '\n')
    return {'status': 'prepared-not-executed', 'manifestSha256': digest_file(output / 'guest-manifest.json'),
            'guestSha256': result['guestEntrypointSha256'], 'image': data['capsuleImageId']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-kit', required=True, type=Path)
    parser.add_argument('--source-manifest-sha256', required=True)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.source_kit, args.source_manifest_sha256, args.out)))
    except (Rejected, OSError, ValueError, KeyError, subprocess.SubprocessError):
        raise SystemExit('LOCAL_VM_PREPARATION_FAILED')
