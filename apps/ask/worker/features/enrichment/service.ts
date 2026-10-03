/**
 * Enrichment service (§6) — the server-side "project understanding + question
 * quality" pass. Given ONLY the room's Q&A text (never repo files, never secrets),
 * it asks Cloudflare Workers AI for (1) a 2-3 sentence read of what the project is
 * about, and (2) a usefulness/lame/improvement verdict for each OPEN question.
 *
 * Contract-first + fail-soft: every model completion is Zod-`safeParse`d and
 * repaired-or-dropped. This module NEVER throws in prod — `runEnrichment` resolves
 * `null` on any failure (no AI binding, model error, unparseable output) so the
 * core Q&A workflow is wholly unaffected. The DO owns throttling, budgeting, and
 * persistence; this module is a pure, typed transform over the input.
 */
import type { ProjectUnderstanding, QuestionQuality } from '@ask/contracts';
import { AiEnrichment, type EnrichmentInput, type EnrichmentInputQuestion } from './schemas';

export type { EnrichmentInput, EnrichmentInputQuestion } from './schemas';

/** Primary model, then a smaller always-available fallback (per the task brief). */
export const PRIMARY_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct';

/** Keep the prompt bounded — the newest N questions is plenty of signal + cheap. */
const MAX_QUESTIONS_IN_PROMPT = 40;
/** Clip each free-text field so one huge answer can't blow the context window. */
const FIELD_CLIP = 500;

/** Minimal shape of the Workers AI binding we use — avoids a hard dep on the global `Ai` type. */
export interface AiRunner {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface EnrichmentResult {
  understanding: ProjectUnderstanding;
  questionQuality: QuestionQuality[];
  model: string;
}

const clip = (s: string | undefined, n = FIELD_CLIP): string =>
  !s ? '' : s.length > n ? `${s.slice(0, n)}…` : s;

/**
 * Build the user prompt. Questions are numbered + tagged open/answered so the
 * model can both summarize the project AND judge only the open ones.
 */
function buildPrompt(input: EnrichmentInput): { openIds: string[]; prompt: string } {
  const qs = input.questions.slice(0, MAX_QUESTIONS_IN_PROMPT);
  const openIds = qs.filter((q) => q.open).map((q) => q.id);

  const lines = qs.map((q, i) => {
    const parts = [`[Q${i + 1}] id=${q.id} (${q.open ? 'OPEN' : 'answered'}) [${q.category}]`];
    parts.push(`  Question: ${clip(q.title, 300)}`);
    if (q.context) parts.push(`  Why it matters: ${clip(q.context)}`);
    if (q.consequence) parts.push(`  Consequence: ${clip(q.consequence)}`);
    if (q.answer) parts.push(`  Answer: ${clip(q.answer)}`);
    return parts.join('\n');
  });

  const prompt = [
    'A coding agent is building a software project and asks its human teammate the decisions it',
    'would otherwise guess at. Below are the questions it has asked and any answers received.',
    '',
    'Do TWO things and return ONE JSON object only (no prose, no markdown fences):',
    '1. "summary": 2-3 sentences, plain language, describing what this project appears to be —',
    '   its purpose and audience — inferred ONLY from the questions and answers below. If there is',
    '   too little signal, say so honestly in one sentence. Never invent specifics.',
    '2. "questions": an array with one entry per OPEN question, each:',
    '   { "questionId": <the id>, "usefulness": <0..1 float>, "lame": <boolean>,',
    '     "improvement": <one short actionable rewrite suggestion, or "" if the question is already good> }.',
    '   Mark "lame": true when a question is vague, redundant with another, trivial, or unlikely to',
    '   change the build. Keep "improvement" under 240 characters.',
    '',
    `OPEN question ids you must score: ${openIds.join(', ') || '(none)'}`,
    '',
    'Questions:',
    ...lines,
  ].join('\n');

  return { openIds, prompt };
}

/** Pull the first balanced JSON object out of a model string (tolerates stray prose/fences). */
function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

/**
 * Normalize the varied `env.AI.run` return shapes into the text completion.
 * Workers AI returns OpenAI-style `choices[0].message.content` for llama-3.x chat
 * models (verified via REST) — older models used `{ response }`. Handle both so the
 * binding shape can change without silently breaking enrichment.
 */
function textFromAiResponse(res: unknown): string | undefined {
  if (typeof res === 'string') return res;
  if (!res || typeof res !== 'object') return undefined;
  const r = res as {
    response?: unknown;
    result?: { response?: unknown; choices?: unknown };
    choices?: unknown;
  };
  if (typeof r.response === 'string') return r.response;
  if (typeof r.result?.response === 'string') return r.result.response;
  const choices = (Array.isArray(r.choices) ? r.choices : undefined) ?? (Array.isArray(r.result?.choices) ? r.result.choices : undefined);
  const content = choices?.[0] && typeof choices[0] === 'object' ? (choices[0] as { message?: { content?: unknown } }).message?.content : undefined;
  return typeof content === 'string' ? content : undefined;
}

/** Coerce a model-supplied usefulness (0..1, 0..100, or numeric string) into 0..1. */
function toUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  let v = value;
  if (v > 1) v = v / 100; // model answered on a 0..100 scale
  return Math.min(1, Math.max(0, v));
}

/**
 * Run one enrichment pass. Returns `null` on ANY failure — never throws.
 * @param ai   the Workers AI binding (`env.AI`), or undefined when unbound.
 * @param input the compact Q&A projection (the only data the model sees).
 */
export async function runEnrichment(
  ai: AiRunner | undefined,
  input: EnrichmentInput,
): Promise<EnrichmentResult | null> {
  if (!ai || input.questions.length === 0) return null;

  const { openIds, prompt } = buildPrompt(input);
  const answeredCount = input.questions.filter((q) => !q.open && q.answer).length;

  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const res = await ai.run(model, {
        max_tokens: 900,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a precise software analyst. You reply with a single valid JSON object and nothing else.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const text = textFromAiResponse(res);
      if (!text) {
        console.log(JSON.stringify({ level: 'warn', msg: 'enrichment: empty AI response', model, shape: typeof res }));
        continue;
      }

      const parsed = AiEnrichment.safeParse(extractJson(text));
      if (!parsed.success) {
        console.log(JSON.stringify({ level: 'warn', msg: 'enrichment: unparseable AI output', model, sample: text.slice(0, 180) }));
        continue;
      }

      const now = new Date().toISOString();
      const openSet = new Set(openIds);
      const seen = new Set<string>();
      const quality: QuestionQuality[] = [];

      // Keep only verdicts that map to a REAL open question; dedupe; repair fields.
      for (const v of parsed.data.questions) {
        if (!openSet.has(v.questionId) || seen.has(v.questionId)) continue;
        seen.add(v.questionId);
        quality.push({
          questionId: v.questionId,
          usefulness: toUnit(v.usefulness),
          lame: Boolean(v.lame),
          improvement: (v.improvement ?? '').slice(0, 400),
          updatedAt: now,
        });
      }

      const understanding: ProjectUnderstanding = {
        summary: parsed.data.summary.slice(0, 1200),
        model,
        basedOnAnswers: answeredCount,
        updatedAt: now,
      };

      return { understanding, questionQuality: quality, model };
    } catch (err) {
      // Model error / transport failure — log (structured), try the fallback, then give up (null).
      console.log(
        JSON.stringify({ level: 'warn', msg: 'enrichment model threw', model, error: String(err instanceof Error ? err.message : err) }),
      );
      continue;
    }
  }

  return null;
}

/** Project a room's stored questions + answers into the compact enrichment input. */
export function toEnrichmentInput(questions: EnrichmentInputQuestion[]): EnrichmentInput {
  return { questions };
}
