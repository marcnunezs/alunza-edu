import { spawn } from 'node:child_process';
import { join } from 'node:path';

const SAMPLE_MS = 500;
const WATCHDOG_MS = 2000;

/** External working-set supervision. One CLR startup per extraction, never per
 * sample. The same two-second bound applies to startup and every fresh sample. */
export function watchWindowsResidentBytes(
  pid: number,
  environment: NodeJS.ProcessEnv,
  onSample: (bytes: number) => void,
  onUnavailable: () => void,
): () => void {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    onUnavailable();
    return () => undefined;
  }
  const executable = join(
    environment.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  // A retained Process handle avoids confusing a recycled PID with the parser.
  // Invariant digits avoid localized tasklist CSV and command/module discovery.
  const command = [
    "$ErrorActionPreference='Stop'",
    '$observed=$null',
    'try {',
    `$observed=[System.Diagnostics.Process]::GetProcessById(${pid})`,
    '$null=$observed.Handle',
    'while (-not $observed.HasExited) {',
    '$observed.Refresh()',
    '$rss=$observed.WorkingSet64',
    'if ($rss -le 0) { if ($observed.HasExited) { break }; exit 1 }',
    '[Console]::WriteLine($rss.ToString([System.Globalization.CultureInfo]::InvariantCulture))',
    '[Console]::Out.Flush()',
    `[System.Threading.Thread]::Sleep(${SAMPLE_MS})`,
    '}',
    "[Console]::WriteLine('EXIT')",
    '[Console]::Out.Flush()',
    '} catch { exit 1 } finally { if ($null -ne $observed) { $observed.Dispose() } }',
  ].join('\n');
  const monitor = spawn(
    executable,
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      windowsHide: true,
      env: environment,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  let active = true;
  let partial = '';
  let outputBytes = 0;
  let watchdog: NodeJS.Timeout;
  const close = () => {
    if (!active) return;
    active = false;
    clearTimeout(watchdog);
    monitor.kill();
  };
  const fail = () => {
    if (!active) return;
    close();
    onUnavailable();
  };
  const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(fail, WATCHDOG_MS);
    watchdog.unref();
  };
  arm();
  monitor.stdout.setEncoding('utf8').on('data', (part: string) => {
    if (!active) return;
    outputBytes += Buffer.byteLength(part);
    // At most 61 short records fit the parser's independent 30-second life.
    if (outputBytes > 8192) return fail();
    partial += part;
    for (;;) {
      const newline = partial.indexOf('\n');
      if (newline < 0) break;
      const line = partial.slice(0, newline).replace(/\r$/u, '');
      partial = partial.slice(newline + 1);
      if (line === 'EXIT') {
        // The trusted external observer saw the retained process exit. Node's
        // child close event may follow later; it alone validates parser output.
        close();
        return;
      }
      if (!/^[1-9][0-9]{0,15}$/u.test(line)) return fail();
      const bytes = Number(line);
      if (!Number.isSafeInteger(bytes)) return fail();
      arm();
      onSample(bytes);
      if (!active) return;
    }
    if (partial.length > 64) fail();
  });
  monitor.once('error', fail);
  monitor.once('close', fail);
  return close;
}
