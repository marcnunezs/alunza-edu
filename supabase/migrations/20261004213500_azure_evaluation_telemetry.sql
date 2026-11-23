-- Safe transport metadata already lives in the durable observation JSON.
-- Extend only its operational projection; prices, budgets and authorization
-- are unchanged. Legacy and missing cache evidence remain null, never zero.
-- The repository migrator batches this file and its history atomically;
-- keep transaction control with the migrator, including this local role.
-- Earlier migrations revoked both grants. Replace as the existing owner and
-- restore the same privileges before the migration transaction finishes.
grant alunza_identity to postgres;
grant create on schema app_private to alunza_identity;
set local role alunza_identity;

create or replace function app_private.evaluation_receipt_projection(c app_private.ai_call_receipts) returns jsonb
language sql stable set search_path=pg_catalog as $$ select jsonb_build_object(
 'callId',c.id,'runId',c.run_id,'stage',c.stage,'phase',c.phase,'state',c.state,'provider',c.provider,
 'configurationId',c.configuration->>'id','model',c.configuration->>'model','dimensions',(c.configuration->>'dimensions')::integer,'inputHash',c.input_hash,
 'observedModel',c.observed_model,'httpStatus',(c.observation->>'httpStatus')::integer,'retryable',(c.observation->>'retryable')::boolean,'aborted',c.aborted,
 'dispatchedAt',c.dispatched_at,'settledAt',c.settled_at,'outcome',c.outcome,'inputTokens',c.input_tokens,'outputTokens',c.output_tokens,
 'requestId',c.provider_request_id,'reservedInputTokens',c.reserved_input_tokens,'maxOutputTokens',c.max_output_tokens,
 'reservedCostMicroUsd',c.reserved_cost::text,'observedCostMicroUsd',c.observed_cost::text,
 -- Bound the text before casting; AND does not guarantee evaluation order.
 'cachedInputTokens',case
   when jsonb_typeof(c.observation->'usage'->'cachedInputTokens')='number'
     and (c.observation->'usage'->>'cachedInputTokens') ~ '^[0-9]{1,10}$'
   then case
     when (c.observation->'usage'->>'cachedInputTokens')::bigint between 0 and 1000000000
       and (c.observation->'usage'->>'cachedInputTokens')::bigint <= c.input_tokens
     then (c.observation->'usage'->>'cachedInputTokens')::bigint else null end
   else null end,
 'retryAfterMs',case
   when jsonb_typeof(c.observation->'retryAfterMs')='number'
     and (c.observation->>'retryAfterMs') ~ '^[0-9]{1,6}$'
   then case
     when (c.observation->>'retryAfterMs')::integer between 0 and 300000
     then (c.observation->>'retryAfterMs')::integer else null end
   else null end,
 'rateLimits',c.observation->'rateLimits') $$;

reset role;
revoke create on schema app_private from alunza_identity;
revoke alunza_identity from postgres;
