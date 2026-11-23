import { z } from 'zod';
import { progressInstantSchema } from './progress-observation';

// The episode is the durable idempotency key. The caller supplies neither
// identity, timestamps nor a replacement state or evidence.
export const signalReviewInputSchema = z.strictObject({});
export const signalReviewQuerySchema = z.strictObject({});
export const signalReviewSchema = z.strictObject({
  signalId: z.uuid(),
  classId: z.uuid(),
  studentId: z.uuid(),
  state: z.literal('REVIEWED'),
  reviewedBy: z.uuid(),
  // Current display label, not a historical name snapshot.
  reviewedByName: z.string().min(1).max(120).nullable(),
  reviewedAt: progressInstantSchema,
});
export const signalReviewResponseSchema = z.strictObject({
  data: signalReviewSchema,
  requestId: z.uuid(),
});
export type SignalReview = z.infer<typeof signalReviewSchema>;
