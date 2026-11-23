import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { responseClosed } from './response-closed';

describe('post-response reserve scheduling boundary', () => {
  it('waits for HTTP finish and removes both event handlers', async () => {
    const response = new EventEmitter() as Response;
    let finished = false;
    const closed = responseClosed(response)!.then((value) => {
      finished = value;
      return value;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    response.emit('finish');
    expect(await closed).toBe(true);
    expect(response.listenerCount('finish')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  it('does not report delivery on a prematurely closed connection', async () => {
    const response = new EventEmitter() as Response;
    const closed = responseClosed(response);
    response.emit('close');
    response.emit('finish');
    expect(await closed).toBe(false);
  });

  it('handles already closed responses and direct non-HTTP service callers', async () => {
    expect(responseClosed()).toBeUndefined();
    expect(await responseClosed({ writableFinished: true } as Response)).toBe(
      true,
    );
    expect(await responseClosed({ destroyed: true } as Response)).toBe(false);
  });
});
