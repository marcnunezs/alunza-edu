import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LivenessService } from './liveness.service';

@Injectable()
class LivenessConsumer {
  constructor(readonly liveness: LivenessService) {}
}

describe('Nest 12 / Jest / TypeScript decorator compatibility', () => {
  it('resolves a real constructor dependency from emitted metadata', async () => {
    const module = await Test.createTestingModule({
      providers: [LivenessService, LivenessConsumer],
    }).compile();
    try {
      const consumer = module.get(LivenessConsumer);
      expect(consumer.liveness).toBe(module.get(LivenessService));
      expect(consumer.liveness.status()).toBe('ok');
    } finally {
      await module.close();
    }
  });
});
