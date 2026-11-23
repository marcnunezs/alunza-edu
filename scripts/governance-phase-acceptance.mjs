import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './local.mjs';
import { report } from './test-environment.mjs';
import { captureSignalCandidate } from './signals-candidate.mjs';
import inventory from './governance-phase.cjs';
import {
  evaluateGovernancePhaseAcceptance,
  parseGovernanceAcceptanceArguments,
} from './governance-phase-acceptance-core.mjs';

export async function collectGovernancePhaseAcceptance(args) {
  const { notBefore } = parseGovernanceAcceptanceArguments(args);
  const candidate = await captureSignalCandidate('governance-phase-acceptance');
  const load = async (name) => {
    try {
      return JSON.parse(
        await readFile(
          join(root, '.local/reports/imp-06', `${name}.json`),
          'utf8',
        ),
      );
    } catch {
      return null;
    }
  };
  const [http, e2e] = await Promise.all([
    load('governance-phase-integration'),
    load('e2e-governance-phase'),
  ]);
  const summary = evaluateGovernancePhaseAcceptance({
    matrix: inventory.acceptanceMatrix,
    caseIds: inventory.phaseCaseIds,
    reports: { http, e2e },
    candidate,
    notBefore,
  });
  await report('governance-phase-acceptance', summary, 'imp-06');
  return summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = await collectGovernancePhaseAcceptance(
      process.argv.slice(2),
    );
    console.log(
      result.functionalStatus === 'passed'
        ? 'IMP-06.07 funcional aprobado; aceptación bloqueada por IMP-06.04 y CI integral no ejecutada.'
        : `Evidencia funcional inválida: ${result.errors.join(', ')}.`,
    );
    process.exitCode = result.exitCode;
  } catch {
    await report(
      'governance-phase-acceptance',
      {
        status: 'failed',
        functionalStatus: 'failed',
        acceptanceStatus: 'blocked',
        increment: 'IMP-06.07',
        errors: ['ACCEPTANCE_COLLECTION_FAILED'],
        ciExecuted: false,
      },
      'imp-06',
    );
    console.error(
      'No se pudo recoger la aceptación; usa --since con un instante UTC del ciclo actual.',
    );
    process.exitCode = 1;
  }
}
