import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { executionContextSchema } from './execution.port';
import type { ExecutionContext } from './execution.port';

const campaignSchema = z.object({
  schemaVersion: z.literal(1),
  environment: z.literal('preproduction'),
  authorized: z.literal(true),
  campaignId: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
  teamId: z.string(),
  projectId: z.string(),
  region: z.string(),
  image: z.string(),
  runnerVersion: z.string(),
  maxCreations: z.number(),
  maxRequests: z.number(),
  maxCost: z.number().positive().finite(),
  currency: z.enum(['USD', 'CLP']),
  candidate: z.object({
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  approval: z.object({
    reference: z.string().min(1).max(200),
    approvedBy: z.string().min(1).max(100),
    approvedAt: z.iso.datetime({ offset: true }),
  }),
});

export interface SandboxConfiguration {
  readonly token: string;
  readonly context: Extract<ExecutionContext, { provider: 'vercel' }>;
}

/** Configuration is private server input; never include parser errors or values in logs. */
export function loadSandboxConfiguration(
  env: NodeJS.ProcessEnv,
  enabled: boolean,
  releaseId?: string,
): SandboxConfiguration | undefined {
  if (!env.SANDBOX_CAMPAIGN_FILE && !enabled) return undefined;
  const path = env.SANDBOX_CAMPAIGN_FILE;
  if (!path || !env.VERCEL_TOKEN || statSync(path).size > 262144)
    throw new Error('Invalid Sandbox configuration');
  const campaign = campaignSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const approvedAt = Date.parse(campaign.approval.approvedAt);
  const expiresAt = Date.parse(campaign.expiresAt);
  if (
    campaign.candidate.commit !== releaseId ||
    approvedAt > Date.now() ||
    expiresAt <= approvedAt
  )
    throw new Error('Invalid Sandbox campaign');
  for (const [key, expected] of [
    ['SANDBOX_TEAM_ID', campaign.teamId],
    ['SANDBOX_PROJECT_ID', campaign.projectId],
    ['SANDBOX_REGION', campaign.region],
    ['SANDBOX_IMAGE', campaign.image],
  ] as const)
    if (env[key] !== expected) throw new Error('Sandbox destination mismatch');
  const context = executionContextSchema.parse({
    provider: 'vercel',
    image: campaign.image,
    runnerVersion: campaign.runnerVersion,
    teamId: campaign.teamId,
    projectId: campaign.projectId,
    region: campaign.region,
    campaignId: campaign.campaignId,
    expiresAt: campaign.expiresAt,
    maxCreations: campaign.maxCreations,
    maxRequests: campaign.maxRequests,
  });
  if (context.provider !== 'vercel')
    throw new Error('Invalid Sandbox provider');
  return Object.freeze({
    token: env.VERCEL_TOKEN,
    context: Object.freeze(context),
  });
}
