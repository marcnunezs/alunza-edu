import { collectExpired } from '../infra/runner/capsule.mjs';
console.log(
  JSON.stringify({
    stage: 'runner:cleanup',
    removedExpired: await collectExpired(),
  }),
);
