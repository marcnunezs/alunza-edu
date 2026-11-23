import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './local.mjs';
import { sha256 } from './evaluation-client.mjs';
import {
  candidateFingerprint,
  evaluationPlanSchema,
  planEvaluation,
} from './evaluation-manifest.mjs';
import { buildEvaluationReviewPacket } from './evaluation-review-packet.mjs';
import { buildEvaluationTeacherReview } from './evaluation-teacher-review.mjs';

const environmentKeys = [
  'AI_AZURE_BASE_URL',
  'AI_AUTH_MODE',
  'AI_EMBEDDING_DEPLOYMENT',
  'AI_EMBEDDING_MODEL',
  'AI_EMBEDDING_DIMENSIONS',
  'AI_CONFIGURATION_ID',
  'AI_GENERATION_DEPLOYMENT',
  'AI_GENERATION_MODEL',
  'AI_GENERATION_CONFIGURATION_ID',
  'AI_GENERATION_TOKENIZER',
  'AI_VERIFICATION_DEPLOYMENT',
  'AI_VERIFICATION_MODEL',
  'AI_AZURE_API_KEY',
  'AI_MANAGED_IDENTITY_CLIENT_ID',
];

// Presence is not authentication, compatibility or permission. Never return
// supplied values, unknown keys, parsing exceptions or a provider credential.
export function summarizeProviderEnvironment(record) {
  return {
    fields: environmentKeys.map((key) => {
      const raw = typeof record?.[key] === 'string' ? record[key].trim() : '';
      const value = raw.replace(/^['"]|['"]$/gu, '').trim();
      return {
        key,
        status: !value
          ? 'ABSENT'
          : /REPLACE|CHANGEME|YOUR[-_]|<[^>]+>/iu.test(value)
            ? 'PLACEHOLDER'
            : 'PRESENT_UNVERIFIED',
      };
    }),
    authenticationVerified: false,
  };
}

export async function localConfigurationPath(input) {
  // Reject UNC/device paths before any filesystem call: even stat on an SMB
  // path can send network credentials. Local inputs must stay in this workspace.
  if (/^(?:\\\\|\/\/)/u.test(input))
    throw new Error('OFFLINE_CONFIGURATION_PATH_OUT_OF_SCOPE');
  const path = resolve(root, input);
  const suffix = relative(root, path);
  if (
    !suffix ||
    isAbsolute(suffix) ||
    suffix === '..' ||
    suffix.startsWith(`..${sep}`)
  )
    throw new Error('OFFLINE_CONFIGURATION_PATH_OUT_OF_SCOPE');
  let current = root;
  const parts = suffix.split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await lstat(current);
    if (
      info.isSymbolicLink() ||
      (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())
    )
      throw new Error('OFFLINE_CONFIGURATION_PATH_LINK_OR_NOT_FILE');
  }
  return path;
}

async function configurationFile(path, format) {
  try {
    const text = await readFile(await localConfigurationPath(path), 'utf8');
    const record =
      format === 'json'
        ? JSON.parse(text)
        : Object.fromEntries(
            text
              .split(/\r?\n/u)
              .map((line) =>
                line.match(/^\s*(?:export\s+)?(AI_[A-Z_]+)\s*=\s*(.*)$/u),
              )
              .filter(Boolean)
              .map((match) => [match[1], match[2]]),
          );
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error('INVALID_CONFIGURATION');
    return { status: 'INSPECTED', ...summarizeProviderEnvironment(record) };
  } catch (error) {
    return {
      status: error.code === 'ENOENT' ? 'ABSENT' : 'UNREADABLE_OR_INVALID',
      authenticationVerified: false,
    };
  }
}

export function buildReadinessReport({
  plan,
  reviewPacket,
  configuration,
  generatedAt,
}) {
  const draft = evaluationPlanSchema.parse(plan);
  if (
    draft.provider !== 'AZURE' ||
    draft.environment !== 'LAB-EVAL' ||
    draft.authorization !== null
  )
    throw new Error('OFFLINE_PREPARATION_REQUIRES_UNAUTHORIZED_AZURE_DRAFT');
  return {
    schemaVersion: 1,
    kind: 'AZURE_HELP_OFFLINE_PREPARATION',
    generatedAt,
    status: 'PREPARED_OFFLINE',
    authorizedForInference: false,
    providerCalls: 0,
    observedTokens: null,
    observedCostMicroUsd: null,
    azureEvaluation: 'NOT_EXECUTED',
    academicAcceptance: 'PENDING',
    calibrationArtifact: null,
    plan: planEvaluation(draft),
    candidateFingerprint: draft.candidateFingerprint,
    corpus: reviewPacket.inventory,
    configuration,
    gates: [
      {
        id: 'AZURE_CONFIGURATION',
        status: 'PENDING',
        needs: [
          'Existing resource endpoint and region; no provisioning in this task.',
          'Embedding, generation and review deployments, response model identities and versions.',
          'Embedding dimensions, tokenizer and configuration IDs compatible with the local contracts.',
          'Chat Completions and structured-output compatibility for generation/review.',
        ],
      },
      {
        id: 'AUTHENTICATION_AND_QUOTA',
        status: 'NOT_VERIFIED',
        needs: [
          'Chosen authentication method and actual resource permission; no credentials in this packet.',
          'Existing assigned capacity/limits for the chosen deployments; no quota increase.',
        ],
      },
      {
        id: 'COST_AND_AUTHORIZATION',
        status: 'PENDING',
        needs: [
          'Current dated prices for actual models, deployment types and region.',
          'Global and per-stage call/token/cost budgets within existing limits.',
          'Real approval reference, approver and expiration for the final candidate and corpus.',
        ],
      },
      {
        id: 'CALIBRATION_AND_HUMAN_REVIEW',
        status: 'PENDING',
        needs: [
          'Review authored labels, reserved partitions, sample breadth and proposed rubric.',
          'Measure Azure distances and server receipts in one run; never reuse illustrative TEST distances.',
          'Generate help-evidence-2 from measurements; no manually chosen threshold.',
          'Record human judgments and disagreements on actual responses; no automatic academic acceptance.',
        ],
      },
      {
        id: 'LOCAL_EVALUATION_ENVIRONMENT',
        status: 'NOT_VERIFIED',
        needs: [
          'Use isolated LAB-EVAL; inspect its existing state before prepare creates product records.',
          'Current evaluator does not accept physical-test; local-vm is not enabled in evaluation.',
          'Do not rename Ryzen state or bypass guards; physical integration requires a separate increment.',
        ],
      },
      {
        id: 'BROWSER_LATENCY',
        status: 'NOT_MEASURED',
        needs: [
          'Visible-feedback measurements bound to the same run/profile/corpus.',
          '100 serial and 100 concurrent helps at concurrency 4; TEST timing is not Azure timing.',
        ],
      },
    ],
  };
}

const sourceFiles = [
  'scripts/evaluation-readiness.mjs',
  'scripts/evaluation-review-packet.mjs',
  'scripts/evaluation-teacher-review.mjs',
  'scripts/evaluation-manifest.mjs',
  'scripts/evaluation-prepare.mjs',
  'scripts/evaluation-run.mjs',
  'fixtures/ai/help-adversarial-manifest.mjs',
  'fixtures/ai/adversarial/corpus.mjs',
  'packages/ai/src/help-calibration.ts',
  'packages/ai/src/help-measurement.ts',
  'packages/contracts/src/evaluation.ts',
  'infra/preproduction/help-evaluation.example.json',
];
const samePath = (a, b) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

async function ownedDirectory(path) {
  try {
    await mkdir(path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    !samePath(await realpath(path), path)
  )
    throw new Error('OFFLINE_PREPARATION_PATH_LINK');
}

export async function prepareLocalEvaluation({
  directory,
  providerEnvironmentPath,
} = {}) {
  const generatedAt = new Date().toISOString();
  const base = join(root, '.local', 'eval-preparation');
  const output = resolve(
    root,
    directory ??
      join(base, `${generatedAt.replaceAll(/[:.]/gu, '-')}-${randomUUID()}`),
  );
  // Only one new direct child of the preparation area; no overwrites of runs,
  // source files or prior evidence, including via junctions/symlinks.
  if (!samePath(dirname(output), base) || basename(output).startsWith('.'))
    throw new Error('OFFLINE_PREPARATION_DIRECTORY_OUT_OF_SCOPE');
  const draft = evaluationPlanSchema.parse(
    JSON.parse(
      await readFile(
        join(root, 'infra/preproduction/help-evaluation.example.json'),
        'utf8',
      ),
    ),
  );
  const reviewPacket = buildEvaluationReviewPacket();
  const teacherReview = buildEvaluationTeacherReview(reviewPacket);
  const configuration = {
    inspection: 'PRESENCE_ONLY_NO_CREDENTIAL_VALIDATION',
    process: summarizeProviderEnvironment(process.env),
    files: [],
  };
  for (const [label, path, format] of [
    ['root-env', join(root, '.env.local'), 'env'],
    ['api-env', join(root, 'apps/api/.env.local'), 'env'],
    ['evaluation-provider', join(root, '.local/eval-provider.json'), 'json'],
    ...(providerEnvironmentPath
      ? [['explicit-provider', resolve(root, providerEnvironmentPath), 'json']]
      : []),
  ])
    configuration.files.push({
      source: label,
      ...(await configurationFile(path, format)),
    });
  const sources = [];
  for (const path of sourceFiles)
    sources.push({ path, sha256: sha256(await readFile(join(root, path))) });
  draft.candidateFingerprint = await candidateFingerprint();
  const report = buildReadinessReport({
    plan: draft,
    reviewPacket,
    configuration,
    generatedAt,
  });
  await ownedDirectory(join(root, '.local'));
  await ownedDirectory(base);
  await mkdir(output); // EEXIST is intentional: never replace an earlier packet.
  const files = {
    'plan-draft.json': draft,
    'review-packet.json': reviewPacket,
    'teacher-design-review.json': teacherReview.reviewTemplate,
    'readiness.json': { ...report, sources },
  };
  const checksums = [];
  for (const [name, data] of Object.entries(files)) {
    const text = `${JSON.stringify(data, null, 2)}\n`;
    await writeFile(join(output, name), text, { flag: 'wx', mode: 0o600 });
    checksums.push({ file: name, sha256: sha256(text) });
  }
  await writeFile(join(output, 'teacher-corpus.md'), teacherReview.markdown, {
    flag: 'wx',
    mode: 0o600,
  });
  checksums.push({
    file: 'teacher-corpus.md',
    sha256: sha256(teacherReview.markdown),
  });
  const readme = `# Preparación offline de ayuda Azure\n\nGenerado: ${generatedAt}.\n\nExpediente preparado; Azure NO ejecutado y aceptación humana PENDIENTE.\nNo es autorización, calibración ni reporte de ejecución.\n\n- plan-draft.json: candidato identificado; configuración/precios/presupuestos/autorización pendientes.\n- review-packet.json: corpus ficticio, etiquetas autorales y revisión humana vacía. Las distancias ilustrativas no calibran Azure.\n- teacher-corpus.md: 47 fichas legibles para revisar diseño y etiquetas.\n- teacher-design-review.json: copia de trabajo con campos humanos vacíos; no evalúa respuestas.\n- readiness.json: inventario, presencia de configuración sin valores y requisitos pendientes.\n- checksums.json: integridad de estos archivos; no certifica resultados.\n\nValida el plan sin iniciar servicios desde la raíz:\n\n\`node scripts/evaluation-cli.mjs --mode plan --manifest .local/eval-preparation/${basename(output)}/plan-draft.json\`\n\nCualquier edición del código/corpus/documentación invalida el fingerprint: genera otro expediente sin borrar éste.\nPara revisar etiquetas, trabaja en una copia y conserva este original con sus hashes.\nGuía: docs/guides/preparacion-evaluacion-azure.md. No ejecutes prepare/authorize/run como comprobaciones offline.\n`;
  await writeFile(join(output, 'README.md'), readme, {
    flag: 'wx',
    mode: 0o600,
  });
  checksums.push({ file: 'README.md', sha256: sha256(readme) });
  await writeFile(
    join(output, 'checksums.json'),
    `${JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', files: checksums }, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  return {
    directory: output,
    status: report.status,
    providerCalls: 0,
    authorizedForInference: false,
    pending: report.plan.pending,
    candidateFingerprint: draft.candidateFingerprint,
  };
}

export async function readinessMain(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const key =
      name === '--directory'
        ? 'directory'
        : name === '--provider-env'
          ? 'providerEnvironmentPath'
          : null;
    if (!key || options[key] || !args[index + 1]?.trim())
      throw new Error('INVALID_OFFLINE_PREPARATION_ARGUMENT');
    options[key] = args[index + 1];
  }
  return prepareLocalEvaluation(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(await readinessMain(process.argv.slice(2)), null, 2),
    );
  } catch {
    // Parsing errors can contain configuration values. CLI diagnostics stay fixed.
    console.error('OFFLINE_EVALUATION_PREPARATION_FAILED');
    process.exitCode = 1;
  }
}
