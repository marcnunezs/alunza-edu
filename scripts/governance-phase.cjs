// Current functional acceptance only; never advances the frozen .04 campaign.
const phaseCaseIds = Object.freeze(
  Array.from(
    { length: 6 },
    (_, i) => `IMP06-PHASE-${String(i + 1).padStart(2, '0')}`,
  ),
);
const mapping = {
  '017': [1, 3, 4, 4],
  '019': [1, 5, 4, 5],
  '024': [2, 3, 4, 2],
  '027': [2, 3, 4, 3],
};
const acceptanceMatrix = Object.freeze(
  Object.entries(mapping).flatMap(([requirement, cases]) =>
    cases.map((number, index) =>
      Object.freeze({
        scenarioId: `ALZ-HU-${requirement}-E${index + 1}`,
        evidence: Object.freeze(
          ['http', 'e2e'].map((suite) =>
            Object.freeze({ suite, caseId: phaseCaseIds[number - 1] }),
          ),
        ),
      }),
    ),
  ),
);

module.exports = { phaseCaseIds, acceptanceMatrix };
