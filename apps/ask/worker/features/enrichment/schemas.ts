/**
 * Enrichment — Zod contracts for the Workers AI boundary (§6, contract-first).
 *
 * The model is asked for ONE JSON object: a short project understanding + a
 * per-open-question quality verdict. We NEVER trust the raw completion — it's
 * `safeParse`d here, coerced where the model is sloppy, and repaired-or-dropped
 * by the service. These schemas describe only the AI's wire shape; the durable
 * public shapes (ProjectUnderstanding / QuestionQuality) live in @ask/contracts.
 */
import { z } from 'zod';

/** One question's verdict as emitted by the model (lenient — the service tightens it). */
export const AiQuestionVerdict = z.object({
  /** The questionId we asked about; validated against the real open set downstream. */
  questionId: z.string().min(1).max(64),
  /** 0..1; models sometimes emit 0..100 or a string — the service clamps + coerces. */
  usefulness: z.number(),
  lame: z.boolean(),
  /** May be empty/omitted when not lame. */
  improvement: z.string().max(600).optional().default(''),
});
export type AiQuestionVerdict = z.infer<typeof AiQuestionVerdict>;

/** The whole AI completion we expect back, parsed from the model's JSON string. */
export const AiEnrichment = z.object({
  summary: z.string().min(1).max(2000),
  questions: z.array(AiQuestionVerdict).max(200).default([]),
});
export type AiEnrichment = z.infer<typeof AiEnrichment>;

/** Compact Q&A projection we feed the model — the ONLY data enrichment ever sees. */
export interface EnrichmentInputQuestion {
  id: string;
  title: string;
  context?: string;
  consequence?: string;
  category: string;
  open: boolean;
  /** The most recent human/agent answer text (or a normalized value summary), if any. */
  answer?: string;
}

export interface EnrichmentInput {
  questions: EnrichmentInputQuestion[];
}
