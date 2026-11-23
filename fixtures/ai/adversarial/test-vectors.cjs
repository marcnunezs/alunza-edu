// Deterministic TEST geometry only. It establishes ledger/retrieval mechanics,
// never semantic quality or a production threshold. No text triggers a fault.
module.exports.testEvaluationVector = (text) =>
  /arreglo almacena|condición booleana/iu.test(text) ? [0, 1, 0] : [1, 0, 0];
