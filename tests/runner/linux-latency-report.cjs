// node tests/runner/linux-latency-report.cjs serial-cold.log serial-preseeded.log serial-preseeded-submit.log
// Also accepts collect.py observations or JSON arrays of {kind, data} records.
const { readFileSync } = require('node:fs');

const target = 5000;
const round = (n) => Math.round(n * 1000) / 1000;
const groups = (rows, key) => Object.entries(Object.groupBy(rows, key));
const finiteMs = (n) => Number.isFinite(n) && n >= 0;
const rank = (sorted, q) => sorted[Math.ceil((q * sorted.length) / 100) - 1];
const linearPhaseNames = [
  'imageResolve',
  'engineResolve',
  'create',
  'preInspect',
  'attachOutput',
  'attachInput',
  'start',
  'send',
  'streamsWaitUnion',
  'postInspect',
  'delete',
  'verifyAbsent',
  'unattributed',
];

function distribution(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n: ordered.length,
    p50Ms: rank(ordered, 50) ?? null,
    p95Ms: rank(ordered, 95) ?? null,
  };
}

function summarizeGroup(rows) {
  const ordered = rows
    .filter((row) => finiteMs(row.executeMs))
    .sort((a, b) => a.executeMs - b.executeMs);
  const traced = ordered.filter(
    (row) =>
      row.complete === true &&
      linearPhaseNames.every((name) => Number.isFinite(row.phaseMs?.[name])),
  );
  const metric = (name) =>
    distribution(rows.map((row) => row[name]).filter(finiteMs));
  const atP95 = rank(ordered, 95);
  const phaseNames = [
    ...new Set(traced.flatMap((row) => Object.keys(row.phaseMs))),
  ];
  const medianPhasesMs = Object.fromEntries(
    phaseNames.map((name) => [
      name,
      distribution(traced.map((row) => row.phaseMs[name])).p50Ms,
    ]),
  );
  const components = {
    start: ['start'],
    streamsWaitUnion: ['streamsWaitUnion'],
    create: ['create'],
    delete: ['delete'],
    createAndStart: ['create', 'start'],
  };
  // Per-row removal is an optimistic upper bound under fixed timings, not a predicted speedup.
  const hypothetical = Object.fromEntries(
    Object.entries(components).map(([key, names]) => {
      const comparable = traced.filter((row) =>
        names.every((name) => finiteMs(row.phaseMs[name])),
      );
      const remainders = comparable.map((row) =>
        round(
          Math.max(
            0,
            row.executeMs -
              names.reduce((total, name) => total + row.phaseMs[name], 0),
          ),
        ),
      );
      const base = distribution(comparable.map((row) => row.executeMs)).p95Ms;
      const residual = distribution(remainders);
      return [
        key,
        {
          n: comparable.length,
          baseP95Ms: base,
          residualP95Ms: residual.p95Ms,
          deltaP95Ms: base === null ? null : round(base - residual.p95Ms),
          under5s: remainders.filter((ms) => ms < target).length,
        },
      ];
    }),
  );
  return {
    group: rows[0].group,
    mode: rows[0].mode,
    attempts: rows.length,
    errors: rows.filter((row) => row.ok !== true).length,
    missingElapsed: rows.length - ordered.length,
    missingTrace: rows.length - traced.length,
    execute: metric('executeMs'),
    under5s: ordered.filter((row) => row.executeMs < target).length,
    successUnder5s: ordered.filter(
      (row) => row.ok === true && row.executeMs < target,
    ).length,
    caseCounts: [...new Set(rows.map((row) => row.caseCount))],
    concurrencyWidths: Object.fromEntries(
      groups(rows, (row) => row.concurrency).map(([width, v]) => [
        width,
        v.length,
      ]),
    ),
    imageIdentity: metric('imageIdentityMs'),
    auditCli: metric('auditCliMs'),
    executeThroughAudit: metric('comparableMs'),
    p95Row: atP95
      ? {
          index: atP95.index,
          wave: atP95.wave,
          ok: atP95.ok,
          executeMs: atP95.executeMs,
          traceComplete: traced.includes(atP95),
          phaseMs: atP95.phaseMs ?? null,
          overlayMs: atP95.overlayMs ?? null,
        }
      : null,
    medianPhasesMs,
    hypothetical,
  };
}

function parseInput(input) {
  const source = input.replace(/^\uFEFF/, '').trimStart();
  // Kernel console lines can start with "[", before the first benchmark marker.
  if (/^LATENCY_[A-Z_]+ /m.test(source))
    return source.split(/\r?\n/).flatMap(parseLine);
  if (source.startsWith('[') || source.startsWith('{')) {
    const json = JSON.parse(source);
    if (Array.isArray(json))
      return json.flatMap((row) => {
        if (typeof row === 'string') return parseLine(row);
        if (row.kind && row.data)
          return [{ kind: row.kind.replace(/^LATENCY_/, ''), data: row.data }];
        if (row.group && row.mode) return [{ kind: 'SAMPLE', data: row }];
        throw new Error('Expected a latency record or sample');
      });
    if (!json.benchRecords || !Array.isArray(json.samples))
      throw new Error('Expected collect.py observations');
    return [
      ...Object.entries(json.benchRecords).flatMap(([kind, values]) =>
        values.map((data) => ({ kind: kind.replace(/^LATENCY_/, ''), data })),
      ),
      ...json.samples.map((data) => ({ kind: 'SAMPLE', data })),
    ];
  }
  return source.split(/\r?\n/).flatMap(parseLine);
}

function parseLine(line) {
  const match = /^LATENCY_([A-Z_]+) (.+)$/.exec(line);
  return match ? [{ kind: match[1], data: JSON.parse(match[2]) }] : [];
}

function summarize(records) {
  if (!records.length) throw new Error('No latency records found');
  const ofKind = (kind) =>
    records
      .filter((record) => record.kind === kind)
      .map((record) => record.data);
  const begin = ofKind('BEGIN'),
    end = ofKind('END');
  if (begin.length > 1 || end.length > 1)
    throw new Error('Pass each boot in a separate file');
  const samples = ofKind('SAMPLE'),
    audits = ofKind('AUDIT_PAIR');
  const errors = samples.filter((row) => row.ok !== true).length;
  const lanes = groups(samples, (row) => row.group + '/' + row.mode);
  const details = lanes.map(([, rows]) => summarizeGroup(rows));
  const duplicateIndices = lanes.flatMap(([, rows]) =>
    rows.filter(
      (row, i) => rows.findIndex((other) => other.index === row.index) !== i,
    ),
  ).length;
  const boot = begin[0]?.boot ?? end[0]?.boot ?? null;
  const countsMatch =
    end.length === 1 &&
    end[0].attempts === samples.length &&
    end[0].errors === errors;
  const planned =
    {
      cold: [['cold-first/RUN', 1]],
      preseeded: [
        ['preseeded-first/RUN', 1],
        ...['RUN', 'SUBMIT'].flatMap((mode) => [
          ['serial/' + mode, begin[0]?.serialPerMode],
          ['c4/' + mode, begin[0]?.c4PerMode],
        ]),
        ['two-case/SUBMIT', begin[0]?.twoCaseSubmit ?? 0],
      ],
      'preseeded-submit': [
        ['two-case-first/SUBMIT', 1],
        ['two-case-series/SUBMIT', begin[0]?.twoCaseSubmit],
      ],
    }[boot] ?? [];
  const coverage = planned.map(([cohort, expected]) => ({
    cohort,
    expected,
    observed: lanes.find(([key]) => key === cohort)?.[1].length ?? 0,
  }));
  const submitSeriesMatches =
    boot !== 'preseeded-submit' ||
    (begin[0]?.twoCaseSubmit === 50 &&
      samples.every(
        (row) =>
          row.caseCount === 2 &&
          row.concurrency === 1 &&
          Number.isInteger(row.index) &&
          row.index >= 1 &&
          row.index <= (row.group === 'two-case-first' ? 1 : 50),
      ));
  const expectedAudits =
    { cold: 0, preseeded: 12, 'preseeded-submit': 0 }[boot] ?? null;
  const distinctAudits = new Set(audits.map((pair) => pair.index)).size;
  const validAudit =
    audits.length === expectedAudits &&
    distinctAudits === audits.length &&
    audits.every(
      (pair) =>
        Number.isInteger(pair.index) &&
        pair.index >= 1 &&
        pair.index <= expectedAudits &&
        pair.match === true &&
        pair.absent === true &&
        finiteMs(pair.cliMs) &&
        finiteMs(pair.apiMs),
    );
  const qualified =
    begin.length === 1 &&
    boot === end[0]?.boot &&
    countsMatch &&
    submitSeriesMatches &&
    coverage.length > 0 &&
    coverage.every((group) => group.expected === group.observed) &&
    coverage.reduce((total, group) => total + group.expected, 0) ===
      samples.length &&
    duplicateIndices === 0 &&
    !errors &&
    end[0]?.finalContainers === 0 &&
    !ofKind('FAILED').length &&
    validAudit &&
    details.every(
      (group) => group.missingElapsed === 0 && group.missingTrace === 0,
    );
  return {
    boot,
    engine: ofKind('ENGINE')[0] ?? null,
    begin: begin[0] ?? null,
    end: end[0] ?? null,
    sampleCount: samples.length,
    errors,
    duplicateIndices,
    coverage,
    countsMatch,
    qualified,
    failures: ofKind('FAILED'),
    groups: details,
    auditPairs: {
      expected: expectedAudits,
      distinctIndices: distinctAudits,
      count: audits.length,
      valid: validAudit,
      cli: distribution(audits.map((p) => p.cliMs).filter(finiteMs)),
      api: distribution(audits.map((p) => p.apiMs).filter(finiteMs)),
      pairedCliMinusApi: distribution(
        audits
          .filter((p) => finiteMs(p.cliMs) && finiteMs(p.apiMs))
          .map((p) => round(p.cliMs - p.apiMs)),
      ),
    },
  };
}

module.exports = { summarize, parseInput };
if (require.main === module) {
  const paths = process.argv.slice(2);
  if (!paths.length)
    throw new Error('Pass the serial log or JSON observations for each boot');
  const boots = paths.map((path) =>
    summarize(parseInput(readFileSync(path, 'utf8'))),
  );
  console.log(
    JSON.stringify(
      {
        scope: 'local runner inside guest',
        targetMs: target,
        percentile: 'nearest rank',
        boots,
      },
      null,
      2,
    ),
  );
  if (boots.some((boot) => !boot.qualified)) process.exitCode = 1;
}
