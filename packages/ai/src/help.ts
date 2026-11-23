import { createHash } from 'node:crypto';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k from 'js-tiktoken/ranks/cl100k_base';
import o200k from 'js-tiktoken/ranks/o200k_base';
import { z } from 'zod';
import {
  diagnosisCodeSchema,
  ragHelpSchema,
  sourceRefSchema,
} from '@alunza/contracts';
import type { DiagnosisCode, RagHelp, SourceRef } from '@alunza/contracts';
import type { RetrievedChunk } from './ports';
import { referenceKey } from './assay';
import type { AiSettlementObserver } from './settlement';
import { describeHelpSyntax, HELP_SYNTAX_UNAVAILABLE } from './help-syntax';

export const HELP_QUERY_VERSION = 'help-query-4';
export const HELP_PROMPT_VERSION = 'help-es-1';
export const HELP_VERIFICATION_PROMPT_VERSION = 'help-review-es-1';
export const HELP_SCHEMA_VERSION = 'rag-help-1';
export const HELP_GENERATION_REQUEST_POLICY_VERSION =
  'help-generation-request-2';
export const HELP_LIMITS = Object.freeze({
  queryTokens: 500,
  corpusTokens: 2500,
  sharedTokens: 5000,
  callInputTokens: 8000,
  generationOutputTokens: 2048,
  verificationOutputTokens: 512,
  tokenizerPieceBytes: 2048,
});
export type HelpTokenizer = 'cl100k_base' | 'o200k_base';
export type HelpKind = 'FEEDBACK' | 'HINT';
export interface HelpContext {
  attemptId: string;
  exerciseVersionId: string;
  statement: string;
  concepts: string[];
  code: string;
  diagnosisCode: DiagnosisCode;
  infrastructureStatus: 'OK' | 'FAILED';
  visibleTests: { id: string; passed: boolean }[];
}
export interface PreparedHelpInput {
  context: HelpContext;
  kind: HelpKind;
  hintLevel: 1 | 2 | 3 | null;
  chunks: RetrievedChunk[];
  truncation: {
    statement: boolean;
    code: boolean;
    visibleTests: boolean;
    concepts: boolean;
  };
  tokenizer: HelpTokenizer;
  promptVersion: typeof HELP_PROMPT_VERSION;
  schemaVersion: typeof HELP_SCHEMA_VERSION;
  contextHash: string;
}
export interface HelpUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  requestId?: string;
}
export interface HelpGenerationPort {
  generate(
    input: PreparedHelpInput,
    signal: AbortSignal,
    observe?: AiSettlementObserver,
  ): Promise<{ candidate: RagHelp; usage?: HelpUsage }>;
}
export const helpVerificationSchema = z
  .strictObject({
    verdict: z.enum(['ACCEPT', 'NO_EVIDENCE', 'REJECT']),
    reason: z.enum([
      'SUPPORTED',
      'INSUFFICIENT_EVIDENCE',
      'AMBIGUOUS_EVIDENCE',
      'UNSUPPORTED_CLAIM',
      'DIAGNOSIS_CONTRADICTION',
      'INVALID_HINT_LEVEL',
      'SOLUTION_DISCLOSURE',
      'INVALID_REFERENCE',
      'INSTRUCTION_INJECTION',
    ]),
    source_refs: z.array(sourceRefSchema).max(5),
  })
  .superRefine((value, ctx) => {
    if (
      (value.verdict === 'ACCEPT' &&
        (value.reason !== 'SUPPORTED' || !value.source_refs.length)) ||
      (value.verdict === 'NO_EVIDENCE' &&
        (!['INSUFFICIENT_EVIDENCE', 'AMBIGUOUS_EVIDENCE'].includes(
          value.reason,
        ) ||
          value.source_refs.length)) ||
      (value.verdict === 'REJECT' &&
        (['SUPPORTED', 'INSUFFICIENT_EVIDENCE', 'AMBIGUOUS_EVIDENCE'].includes(
          value.reason,
        ) ||
          value.source_refs.length))
    )
      ctx.addIssue({ code: 'custom', message: 'Inconsistent verification.' });
  });
export type HelpVerification = z.infer<typeof helpVerificationSchema>;
export interface HelpVerificationPort {
  verify(
    input: PreparedHelpInput,
    candidate: RagHelp,
    signal: AbortSignal,
    observe?: AiSettlementObserver,
  ): Promise<{ verification: HelpVerification; usage?: HelpUsage }>;
}
// Internal diagnostic labels only: never retain provider text or schema issues.
export const helpOutputRejectionReasonSchema = z.enum([
  'MODEL_MISMATCH',
  'CHOICE_INVALID',
  'FINISH_REASON_INVALID',
  'REFUSAL',
  'TOOL_CALLS_PRESENT',
  'CONTENT_INVALID',
  'BYTE_LIMIT_EXCEEDED',
  'TOKEN_LIMIT_EXCEEDED',
  'JSON_INVALID',
  'SCHEMA_INVALID',
  'DIAGNOSIS_MISMATCH',
  'TEXT_INVALID',
  'REFERENCES_DUPLICATE',
  'REFERENCE_NOT_ALLOWED',
  'KIND_MISMATCH',
  'VERIFICATION_SCHEMA_INVALID',
  'VERIFICATION_REFERENCES_MISMATCH',
  'RESPONSE_PROCESSING_INVALID',
]);
export type HelpOutputRejectionReason = z.infer<
  typeof helpOutputRejectionReasonSchema
>;
export class HelpBoundaryError extends Error {
  readonly rejectionReason?: HelpOutputRejectionReason;
  constructor(
    readonly code:
      | 'INVALID_CONTEXT'
      | 'INVALID_HINT_LEVEL'
      | 'INVALID_CONFIGURATION'
      | 'CONFIGURATION_MISSING'
      | 'CONTEXT_TOO_LARGE'
      | 'INVALID_OUTPUT'
      | 'PROVIDER_UNAVAILABLE'
      | 'CALIBRATION_INVALID'
      | 'CANCELLED',
    readonly usage?: HelpUsage,
    rejectionReason?: HelpOutputRejectionReason,
  ) {
    super(code);
    this.name = 'HelpBoundaryError';
    const reason = helpOutputRejectionReasonSchema.safeParse(rejectionReason);
    if (code === 'INVALID_OUTPUT' && reason.success)
      this.rejectionReason = reason.data;
  }
}
const encoders = new Map<HelpTokenizer, Tiktoken>();
function encoder(tokenizer: HelpTokenizer): Tiktoken {
  if (!['cl100k_base', 'o200k_base'].includes(tokenizer))
    throw new HelpBoundaryError('INVALID_CONFIGURATION');
  let value = encoders.get(tokenizer);
  if (!value) {
    value = new Tiktoken(tokenizer === 'cl100k_base' ? cl100k : o200k);
    encoders.set(tokenizer, value);
  }
  return value;
}
export function helpTokenCount(
  text: string,
  tokenizer: HelpTokenizer = 'cl100k_base',
): number {
  tokenizerPreflight(text, tokenizer);
  return encoder(tokenizer).encode(text, [], []).length;
}
function tokenizerPreflight(text: string, tokenizer: HelpTokenizer): void {
  if (Buffer.byteLength(text, 'utf8') > 200_000)
    throw new HelpBoundaryError('CONTEXT_TOO_LARGE');
  if (!['cl100k_base', 'o200k_base'].includes(tokenizer))
    throw new HelpBoundaryError('INVALID_CONFIGURATION');
  // js-tiktoken's merge algorithm is quadratic within a regex piece. This
  // reversible CPU bound uses the exact pinned tokenizer pattern and rejects
  // oversized pieces before encode; accepted text and counts remain unchanged.
  const ranks = tokenizer === 'cl100k_base' ? cl100k : o200k;
  for (const match of text.matchAll(new RegExp(ranks.pat_str, 'gu')))
    if (Buffer.byteLength(match[0], 'utf8') > HELP_LIMITS.tokenizerPieceBytes)
      throw new HelpBoundaryError('CONTEXT_TOO_LARGE');
}
// Byte-prefix first bounds tokenizer work for large hostile strings. Windows may
// end inside a Unicode code point; TextDecoder never invents a replacement glyph.
function clip(text: string, limit: number, tokenizer: HelpTokenizer): string {
  const bytes = Buffer.from(text, 'utf8');
  let byteEnd = Math.min(bytes.length, limit * 4);
  let prefix = '';
  while (byteEnd > 0) {
    try {
      prefix = new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(0, byteEnd),
      );
      break;
    } catch {
      byteEnd--;
    }
  }
  tokenizerPreflight(prefix, tokenizer);
  const tokens = encoder(tokenizer).encode(prefix, [], []);
  let end = Math.min(tokens.length, limit);
  let result = encoder(tokenizer).decode(tokens.slice(0, end));
  while (
    end > 0 &&
    (!prefix.startsWith(result) || helpTokenCount(result, tokenizer) > limit)
  )
    result = encoder(tokenizer).decode(tokens.slice(0, --end));
  return result;
}
const unicodeIsValid = (value: string): boolean =>
  !value.includes('\0') &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    value,
  );
const text = z.string().max(65536).refine(unicodeIsValid);
const contextSchema = z.strictObject({
  attemptId: z.uuid(),
  exerciseVersionId: z.uuid(),
  statement: text,
  concepts: z.array(z.string().max(200).refine(unicodeIsValid)).max(100),
  code: text,
  diagnosisCode: diagnosisCodeSchema,
  infrastructureStatus: z.enum(['OK', 'FAILED']),
  visibleTests: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100).refine(unicodeIsValid),
        passed: z.boolean(),
      }),
    )
    .max(8),
});
function contextAllowlist(context: HelpContext): HelpContext {
  const parsed = contextSchema.safeParse({
    attemptId: context?.attemptId,
    exerciseVersionId: context?.exerciseVersionId,
    statement: context?.statement,
    concepts: context?.concepts,
    code: context?.code,
    diagnosisCode: context?.diagnosisCode,
    infrastructureStatus: context?.infrastructureStatus,
    visibleTests: Array.isArray(context?.visibleTests)
      ? context.visibleTests.map((item) => ({
          id: item?.id,
          passed: item?.passed,
        }))
      : undefined,
  });
  if (
    !parsed.success ||
    (parsed.data.infrastructureStatus === 'FAILED' &&
      parsed.data.diagnosisCode !== 'UNKNOWN')
  )
    throw new HelpBoundaryError('INVALID_CONTEXT');
  return parsed.data;
}
export function buildHelpQuery(context: HelpContext): string {
  const value = contextAllowlist(context);
  // These are literal retrieval data, never a diagnosis inferred from code.
  // The complete persisted context still goes to generation and verification.
  const excerpt = (text: string, tokens: number, omitted = false): string => {
    const prefix = clip(text, tokens, 'cl100k_base');
    return prefix + (omitted || prefix !== text ? '\n[fragmento inicial]' : '');
  };
  const syntaxLines = describeHelpSyntax(value.code);
  const syntax: string[] = [];
  for (const line of syntaxLines) {
    if (
      helpTokenCount(
        [...syntax, line, '[hechos restantes omitidos]'].join('\n'),
      ) > 140
    )
      break;
    syntax.push(line);
  }
  if (syntax.length !== syntaxLines.length)
    syntax.push('[hechos restantes omitidos]');
  const syntaxAvailable = syntaxLines[0] !== HELP_SYNTAX_UNAVAILABLE;
  // When syntax is available, keep facts dominant instead of embedding the
  // narrative and transport/result metadata. A small literal code fragment
  // retains useful task-specific evidence; it is not an ID or deduplication salt.
  const query = (
    syntaxAvailable
      ? [
          'Funciones de JavaScript y devolución de valores.',
          `Conceptos: ${excerpt(value.concepts.slice(0, 8).join('; '), 40, value.concepts.length > 8)}`,
          `Estructura por función:\n${syntax.join('\n')}`,
          `Código JavaScript (datos): ${excerpt(value.code, 32)}`,
        ]
      : [
          // Unsupported or bounded-out analysis retains the previous representation.
          // It never rejects otherwise permitted code or invents structural facts.
          'Material de Programación I en JavaScript para comprender el código y revisar su resultado.',
          `Conceptos (datos): ${excerpt(value.concepts.slice(0, 8).join('; '), 40, value.concepts.length > 8)}`,
          `Hechos sintácticos (sin inferir corrección; return propios excluyen funciones anidadas):\n${syntax.join('\n')}`,
          `Código JavaScript (datos): ${excerpt(value.code, 100)}`,
          `Enunciado (datos): ${excerpt(value.statement, 80)}`,
          `Diagnóstico persistido: ${value.diagnosisCode}`,
          `Infraestructura: ${value.infrastructureStatus}`,
          `Pruebas visibles: ${value.visibleTests.filter(({ passed }) => passed).length} de ${value.visibleTests.length} aprobadas.`,
        ]
  ).join('\n');
  // Keep every selected section or fail closed. Never silently clip the
  // assembled query and drop a later section.
  if (helpTokenCount(query, 'cl100k_base') > HELP_LIMITS.queryTokens)
    throw new HelpBoundaryError('CONTEXT_TOO_LARGE');
  return query;
}
export function buildHelpInput(
  input: {
    context: HelpContext;
    kind: HelpKind;
    hintLevel: 1 | 2 | 3 | null;
    chunks: readonly RetrievedChunk[];
  },
  tokenizer: HelpTokenizer = 'cl100k_base',
): PreparedHelpInput {
  const context = contextAllowlist(input.context);
  if (
    (input.kind === 'FEEDBACK' && input.hintLevel !== null) ||
    (input.kind === 'HINT' &&
      (![1, 2, 3].includes(input.hintLevel ?? 0) ||
        context.diagnosisCode === 'SUCCESS' ||
        (context.diagnosisCode === 'UNKNOWN' &&
          context.infrastructureStatus === 'FAILED'))) ||
    !['FEEDBACK', 'HINT'].includes(input.kind)
  )
    throw new HelpBoundaryError('INVALID_HINT_LEVEL');
  if (
    !Array.isArray(input.chunks) ||
    !input.chunks.length ||
    input.chunks.length > 5
  )
    throw new HelpBoundaryError('INVALID_CONTEXT');
  let corpusTokens = 0;
  const chunks = input.chunks.map((chunk) => {
    const ref = sourceRefSchema.safeParse({
      source_id: chunk?.source_id,
      source_version_id: chunk?.source_version_id,
      chunk_id: chunk?.chunk_id,
      locator: chunk?.locator,
    });
    if (
      !ref.success ||
      chunk.locator.length > 200 ||
      typeof chunk.text !== 'string' ||
      !chunk.text.trim() ||
      !unicodeIsValid(chunk.text) ||
      !unicodeIsValid(chunk.locator) ||
      !Number.isFinite(chunk.distance) ||
      chunk.distance < 0 ||
      chunk.distance > 2 ||
      helpTokenCount(chunk.text) > 500
    )
      throw new HelpBoundaryError('INVALID_CONTEXT');
    corpusTokens += helpTokenCount(chunk.text);
    return { ...ref.data, text: chunk.text, distance: chunk.distance };
  });
  if (
    corpusTokens > HELP_LIMITS.corpusTokens ||
    new Set(chunks.map(referenceKey)).size !== chunks.length
  )
    throw new HelpBoundaryError('INVALID_CONTEXT');
  const truncation = {
    statement: false,
    code: false,
    visibleTests: false,
    concepts: false,
  };
  const shared: Omit<PreparedHelpInput, 'contextHash'> = {
    context,
    kind: input.kind,
    hintLevel: input.hintLevel,
    chunks,
    truncation,
    tokenizer,
    promptVersion: HELP_PROMPT_VERSION,
    schemaVersion: HELP_SCHEMA_VERSION,
  };
  const result = {
    ...shared,
    contextHash: createHash('sha256')
      .update(canonicalJson(shared))
      .digest('hex'),
  };
  if (
    helpTokenCount(JSON.stringify(result), tokenizer) > HELP_LIMITS.sharedTokens
  )
    throw new HelpBoundaryError('CONTEXT_TOO_LARGE');
  return result;
}
// PostgreSQL JSONB does not preserve object key order. Checkpoints bind the
// complete allowlisted payload independently of its serialized property order.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const preparedSchema = z.strictObject({
  context: contextSchema,
  kind: z.enum(['FEEDBACK', 'HINT']),
  hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
  chunks: z
    .array(
      sourceRefSchema.extend({
        text,
        distance: z.number().finite().min(0).max(2),
      }),
    )
    .min(1)
    .max(5),
  truncation: z.strictObject({
    statement: z.literal(false),
    code: z.literal(false),
    visibleTests: z.literal(false),
    concepts: z.literal(false),
  }),
  tokenizer: z.enum(['cl100k_base', 'o200k_base']),
  promptVersion: z.literal(HELP_PROMPT_VERSION),
  schemaVersion: z.literal(HELP_SCHEMA_VERSION),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
export function validatePreparedHelpInput(value: unknown): PreparedHelpInput {
  const parsed = preparedSchema.safeParse(value);
  if (!parsed.success) throw new HelpBoundaryError('INVALID_CONTEXT');
  const rebuilt = buildHelpInput(parsed.data, parsed.data.tokenizer);
  if (rebuilt.contextHash !== parsed.data.contextHash)
    throw new HelpBoundaryError('INVALID_CONTEXT');
  return rebuilt;
}
function plain(value: string): boolean {
  return (
    unicodeIsValid(value) &&
    !/<\/?[a-z][^>]*>|https?:\/\//iu.test(value) &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(character),
    )
  );
}
export function validateHelpCandidate(
  input: PreparedHelpInput,
  raw: unknown,
): RagHelp {
  const parsed = ragHelpSchema.safeParse(raw);
  if (!parsed.success)
    throw new HelpBoundaryError('INVALID_OUTPUT', undefined, 'SCHEMA_INVALID');
  const candidate = parsed.data;
  const allowed = new Set(input.chunks.map(referenceKey));
  if (candidate.diagnosis_code !== input.context.diagnosisCode)
    throw new HelpBoundaryError(
      'INVALID_OUTPUT',
      undefined,
      'DIAGNOSIS_MISMATCH',
    );
  if (!plain(candidate.explanation) || !plain(candidate.hint))
    throw new HelpBoundaryError('INVALID_OUTPUT', undefined, 'TEXT_INVALID');
  if (
    new Set(candidate.source_refs.map(referenceKey)).size !==
    candidate.source_refs.length
  )
    throw new HelpBoundaryError(
      'INVALID_OUTPUT',
      undefined,
      'REFERENCES_DUPLICATE',
    );
  if (candidate.source_refs.some((ref) => !allowed.has(referenceKey(ref))))
    throw new HelpBoundaryError(
      'INVALID_OUTPUT',
      undefined,
      'REFERENCE_NOT_ALLOWED',
    );
  if (
    (input.kind === 'FEEDBACK' && candidate.hint !== '') ||
    (input.kind === 'HINT' &&
      candidate.status === 'SUPPORTED' &&
      !candidate.hint.trim())
  )
    throw new HelpBoundaryError('INVALID_OUTPUT', undefined, 'KIND_MISMATCH');
  if (
    helpTokenCount(JSON.stringify(candidate), input.tokenizer) >
    HELP_LIMITS.generationOutputTokens
  )
    throw new HelpBoundaryError(
      'INVALID_OUTPUT',
      undefined,
      'TOKEN_LIMIT_EXCEEDED',
    );
  return candidate;
}
export function validateHelpVerification(
  input: PreparedHelpInput,
  candidate: RagHelp,
  raw: unknown,
): HelpVerification {
  validateHelpCandidate(input, candidate);
  const parsed = helpVerificationSchema.safeParse(raw);
  if (!parsed.success)
    throw new HelpBoundaryError(
      'INVALID_OUTPUT',
      undefined,
      'VERIFICATION_SCHEMA_INVALID',
    );
  const value = parsed.data;
  const expected = new Set(candidate.source_refs.map(referenceKey));
  if (
    new Set(value.source_refs.map(referenceKey)).size !==
    value.source_refs.length
  )
    throw new HelpBoundaryError(
      'INVALID_OUTPUT',
      undefined,
      'REFERENCES_DUPLICATE',
    );
  if (
    value.verdict === 'ACCEPT' &&
    (candidate.status !== 'SUPPORTED' ||
      value.source_refs.length !== expected.size ||
      value.source_refs.some(
        (ref: SourceRef) => !expected.has(referenceKey(ref)),
      ))
  )
    throw new HelpBoundaryError(
      'INVALID_OUTPUT',
      undefined,
      'VERIFICATION_REFERENCES_MISMATCH',
    );
  return value;
}
