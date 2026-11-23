import { spawnSync } from 'node:child_process';
import {
  remoteDriverExitCodes,
  remoteDriverFailureMarker,
} from '../infra/runner/timing.mjs';

// Exercise the loaded OCI artifact by digest. The expected dockerd refusal
// keeps this check independent of host Docker privileges and its socket.
const reference = process.argv[2];
if (!reference || !/^(?:[a-z0-9./:_-]+@)?sha256:[0-9a-f]{64}$/.test(reference))
  throw new Error('Pass the digest of a locally loaded Sandbox image');

function check(options, commands) {
  const run = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--pull=never',
      '--network=none',
      '--read-only',
      '--cpus=1',
      '--memory=256m',
      '--pids-limit=64',
      '--cap-drop=ALL',
      ...options,
      '--entrypoint=/bin/sh',
      '-i',
      reference,
      '-exs',
    ],
    { input: commands, encoding: 'utf8', timeout: 45000, windowsHide: true },
  );
  if (run.error) throw run.error;
  if (run.status !== 0)
    throw new Error(
      `Sandbox image check failed (${run.status}): ${run.stderr.trim()}`,
    );
}

check(
  ['--security-opt=no-new-privileges'],
  `
test "$(id -un)" = node
test "$(pwd)" = /vercel/sandbox
test "$(stat -c %u:%a .)" = 1000:700
for directory in /opt /opt/alunza /opt/alunza/supervisor; do
  test "$(stat -c %u:%a "$directory")" = 0:755
done
for module in capsule docker-engine timing remote-init remote-driver; do
  test "$(stat -c %u:%a "/opt/alunza/supervisor/$module.mjs")" = 0:444
done
test "$(PATH=/usr/bin:/bin /usr/local/bin/node --version)" = v24.21.0
test -r /opt/alunza/capsule.tar
/usr/bin/docker --version >/dev/null
/usr/sbin/dockerd --version >/dev/null
test ! -S /var/run/docker.sock
`,
);

// Only this disposable outer container needs setuid for the sudo contract.
// A sticky directory and root-owned fixtures make successful cleanup observable.
check(
  [
    '--user=0:0',
    '--cap-add=SETUID',
    '--cap-add=SETGID',
    '--cap-add=AUDIT_WRITE',
    '--tmpfs=/run',
    '--tmpfs=/tmp',
    '--tmpfs=/vercel/sandbox:mode=1777',
  ],
  `
as_node() { /usr/bin/setpriv --reuid=node --regid=node --clear-groups -- "$@"; }
/usr/sbin/visudo -cf /etc/sudoers >/dev/null
test "$(as_node id -u)" = 1000
test ! -S /var/run/docker.sock
input=/vercel/sandbox/alunza-input-00000000-0000-4000-8000-000000000001.json
output=/vercel/sandbox/alunza-result-00000000-0000-4000-8000-000000000001.json
touch "$input" "$output"
if as_node rm -f "$input" 2>/dev/null; then exit 1; fi
if as_node /usr/bin/sudo -n -- /usr/local/bin/node --version 2>/dev/null; then exit 1; fi
as_node /usr/bin/sudo -n -- /usr/local/bin/node /opt/alunza/supervisor/remote-driver.mjs cleanup "$input" "$output"
test ! -e "$input"
test ! -e "$output"
as_node sh -c 'umask 077; printf "{" > "$1"' sh "$input"
expect_driver_failure() {
  driver_exit=0
  /usr/bin/setpriv --reuid=node --regid=node --clear-groups -- /usr/bin/sudo -n -- /usr/local/bin/node /opt/alunza/supervisor/remote-driver.mjs execute "$input" "$output" >/tmp/driver-out 2>/tmp/driver-error || driver_exit=$?
  test "$driver_exit" -eq "$1"
  test ! -s /tmp/driver-out
  printf '%s' '${remoteDriverFailureMarker}' | cmp -s - /tmp/driver-error
  test ! -e "$input"
  test ! -e "$output"
}
# Root in this restricted container cannot read another UID's 0600 file.
expect_driver_failure ${remoteDriverExitCodes.INPUT_READ}
(umask 077; printf '{' > "$input")
expect_driver_failure ${remoteDriverExitCodes.INPUT_DECODE}
(umask 077; printf '%s' '{"executionId":"00000000-0000-4000-8000-000000000001"}' > "$input")
expect_driver_failure ${remoteDriverExitCodes.ENGINE_RESOLVE}
if as_node env PATH=/usr/bin:/bin ALUNZA_SANDBOX_BOOTSTRAP=1 /usr/bin/sudo -n -- /usr/local/bin/node /opt/alunza/supervisor/remote-init.mjs 2>/tmp/bootstrap-error; then exit 1; fi
grep -Fxq 'Error: Nested Docker unavailable' /tmp/bootstrap-error || { cat /tmp/bootstrap-error >&2; exit 1; }
`,
);

console.log(
  JSON.stringify({
    reference,
    supervisor: 'verified',
    observedFailurePhases: ['INPUT_READ', 'INPUT_DECODE', 'ENGINE_RESOLVE'],
    nestedDocker: 'unverified',
    environment: 'local',
  }),
);
