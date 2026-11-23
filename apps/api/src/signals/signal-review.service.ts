import { Injectable } from '@nestjs/common';
import { signalReviewSchema } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import type { Actor } from '../governance/governance.shared';

@Injectable()
export class SignalReviewService {
  constructor(private readonly database: DatabaseService) {}

  review(who: Actor, signalId: string) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await client.query("SELECT set_config('app.request_id',$1,true)", [
          who.requestId,
        ]);
        const { rows } = await client.query(
          'SELECT app_private.signal_review($1::uuid) AS data',
          [signalId],
        );
        const result = signalReviewSchema.parse(rows[0]?.data);
        if (result.signalId !== signalId)
          throw new Error('Signal review scope mismatch.');
        return result;
      },
      who.sessionId,
    );
  }
}
