import type { HelpKind, HelpReference } from '@alunza/contracts';
import type { HelpContext, HelpUsage } from '@alunza/ai';

export type HelpPhase = 'EMBEDDING' | 'GENERATION' | 'REVIEW';
export interface HelpJob {
  id: string;
  token: string;
  attemptId: string;
  kind: HelpKind;
  hintLevel: 1 | 2 | 3 | null;
  deadlineAt: string;
}
export interface HelpJobContext {
  scope: {
    organizationId: string;
    classId: string;
    activityId: string;
    studentId: string;
  };
  context: HelpContext;
}
export type HelpCall =
  | { state: 'DISPATCH' }
  | { state: 'COMPLETED'; result: unknown }
  | { state: 'STOP' };
export interface HelpPrivateReference extends HelpReference {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}
export type HelpCallUsage = HelpUsage;
// Durable schema: app.feedback_requests, app.feedbacks, app.feedback_source_refs;
// app_private.help_calls, help_context_refs, help_events. Worker entry points are
// help_claim/renew/context/retrieve/set_context_refs/begin_call/complete_call/
// revalidate/finish/fail. SQL helper functions own transitions and fencing.
