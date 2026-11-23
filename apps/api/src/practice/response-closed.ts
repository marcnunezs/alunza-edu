import type { Response } from 'express';

/** Observes delivery only; it never delays or changes an HTTP response. */
export function responseClosed(
  response?: Response,
): Promise<boolean> | undefined {
  if (!response) return undefined;
  if (response.writableFinished) return Promise.resolve(true);
  if (response.destroyed) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (finished: boolean) => {
      response.off('finish', finish);
      response.off('close', close);
      resolve(finished);
    };
    const finish = () => done(true);
    const close = () => done(false);
    response.once('finish', finish);
    response.once('close', close);
  });
}
