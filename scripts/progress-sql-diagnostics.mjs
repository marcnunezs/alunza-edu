import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, cli, redactDiagnostics } from './local.mjs';
import { withTestEnvironment, report } from './test-environment.mjs';
import { testTarget } from './local-target.mjs';

// The caller owns TEST. Twenty separately rolled-back pgTAP transactions retain
// every result; no failure is discarded and no academic value controls a retry.
export async function runProgressSqlDiagnostics({ ctx, iterations = 20 }) {
  assert.equal(ctx.projectId, testTarget.projectId);
  assert.equal(
    iterations,
    20,
    'The acceptance profile requires twenty iterations.',
  );
  const sourcePath = join(root, 'supabase/tests/015_dashboard.test.sql');
  const source = await readFile(sourcePath, 'utf8');
  const sourceDigest = createHash('sha256').update(source).digest('hex');
  const path = join(ctx.projectDir, 'supabase/tests/015_dashboard.test.sql');
  const saved = await readFile(path, 'utf8');
  const directory = join(root, '.local/evidence/imp-05-08/sql');
  await mkdir(directory, { recursive: true });
  const samples = [];
  try {
    await writeFile(
      path,
      source.replace(
        'begin;',
        "begin;\nset local test.dashboard.diagnostics='on';",
      ),
    );
    for (let iteration = 1; iteration <= iterations; iteration++) {
      const startedAt = new Date().toISOString();
      let exitCode = null;
      let output;
      let executionFailure = false;
      try {
        const result = await cli(ctx, ['test', 'db', path], {
          allowFailure: true,
        });
        exitCode = result.code;
        output = redactDiagnostics(result.stdout + result.stderr);
      } catch (error) {
        executionFailure = true;
        output = redactDiagnostics(
          error.output ?? error.message ?? 'SQL_DIAGNOSTIC_EXECUTION_FAILED',
        );
      }
      await writeFile(
        join(directory, `iteration-${String(iteration).padStart(2, '0')}.log`),
        output,
        { mode: 0o600 },
      );
      const match = output.match(/^# IMP05_SQL57 (\{.*\})\r?$/m);
      let diagnostic = null;
      let parseFailure = null;
      try {
        if (!match) parseFailure = 'DIAGNOSTIC_MISSING';
        else diagnostic = JSON.parse(match[1]);
      } catch {
        parseFailure = 'DIAGNOSTIC_INVALID_JSON';
      }
      samples.push({
        iteration,
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode,
        executionFailure,
        parseFailure,
        passed:
          exitCode === 0 && /Result: PASS/.test(output) && diagnostic !== null,
        assertions: output.match(/Files=\d+,\s*Tests=\d+/)?.[0] ?? null,
        diagnostic,
      });
      console.log(
        `SQL diagnostic ${iteration}/${iterations}: ${samples.at(-1).passed ? 'PASS' : 'FAIL'}`,
      );
    }
  } finally {
    await writeFile(path, saved);
  }
  const summary = {
    increment: 'IMP-05.08',
    sourceDigest,
    iterations,
    passed: samples.every((s) => s.passed),
    failures: samples.filter((s) => !s.passed).length,
    sourceUnchanged:
      createHash('sha256')
        .update(await readFile(sourcePath))
        .digest('hex') === sourceDigest,
    profile:
      'Isolated TEST; actual canonical staging and pgTAP; no sleep, counter retry, SQL expectation reduction or remote provider.',
    samples,
  };
  await report('progress-sql-diagnostics', summary, 'imp-05');
  assert.ok(summary.sourceUnchanged, 'SQL_DIAGNOSTIC_SOURCE_CHANGED');
  assert.ok(summary.passed, 'SQL_DIAGNOSTIC_PROFILE_FAILED');
  return summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await withTestEnvironment(async ({ ctx }) =>
      runProgressSqlDiagnostics({ ctx }),
    );
  } catch {
    console.error(
      'El perfil SQL de veinte iteraciones falló; conservar el informe y todas las muestras.',
    );
    process.exitCode = 1;
  }
}
