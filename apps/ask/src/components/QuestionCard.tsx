/**
 * QuestionCard — one decision, rendered calmly and gorgeously (§5, §6).
 *
 * Every card shows the FIVE lines the spec asks for:
 *   1. the question (title)
 *   2. why it matters now (context)
 *   3. what different answers change (consequence)
 *   4. the recommendation — as a LABELED suggestion, never pre-selected
 *   5. a "work continues without this" / "blocks work" badge derived from blocksWork
 *
 * Controls per kind: a kind-appropriate input (single, multiple, short_text,
 * long_text, number, range, link, image_comparison) + an always-available
 * free-text note + Skip for now + Let the agent decide (delegate, value
 * {kind:'delegate'}) + Explain more (POSTs a context-request; 501 → "requested").
 *
 * Submitting is EXPLICIT. Draft state is owned by the parent and passed in, so
 * switching between cards never loses an unsent draft, and a newly-arrived
 * question can't steal focus or reorder the card you're working on. Unsent drafts
 * are visually distinct (dashed accent rail + "Draft" tag) from saved answers.
 */
import { useId, useState } from 'react';
import { Badge, Button, Checkbox, Input, InputArea, Radio, Tooltip } from '@cloudflare/kumo';
import {
  ChatCircleDots,
  CheckCircle,
  HandPalm,
  Lightbulb,
  PaperPlaneTilt,
  PencilLine,
  Sparkle,
  Warning,
} from '@phosphor-icons/react';
import type { AnswerRevision, AnswerValue, Question } from '@ask/contracts';
import { answerStatusChip } from '../status';
import type { PendingAnswer } from '../useRoom';
import { Card, Heading, MetaLine, Mono } from './ui';

/** Draft held in the parent, keyed by question id — survives card switches. */
export interface QuestionDraft {
  selected: string[]; // for single/multiple/image_comparison (single-element for single)
  text: string; // short_text/long_text value OR the free-text note
  number: string; // number value as a string (parsed on submit)
  link: string; // link URL
}

export const emptyDraft: QuestionDraft = { selected: [], text: '', number: '', link: '' };

interface Props {
  question: Question;
  /** Latest committed answer for this question, if any. */
  answer?: AnswerRevision;
  /** Optimistic (unsent/sending) state, if any. */
  pending?: PendingAnswer;
  draft: QuestionDraft;
  onDraftChange: (next: QuestionDraft) => void;
  onSubmit: (value: AnswerValue | undefined, text: string | undefined) => void;
  /** Ask the agent to explain; resolves true if the server accepted, false if 501. */
  onExplainMore: () => Promise<boolean>;
  /** Mobile focus view renders a slimmer frame (the card is already the hero). */
  compact?: boolean;
  autoFocus?: boolean;
}

/** Image-comparison picker: a responsive grid of option thumbnails, single-select. */
function ImageComparison({
  question,
  draft,
  onDraftChange,
}: {
  question: Question;
  draft: QuestionDraft;
  onDraftChange: (next: QuestionDraft) => void;
}) {
  const selected = draft.selected[0] ?? '';
  return (
    <div role="radiogroup" aria-label={question.title} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {question.options.map((opt) => {
        const isSel = selected === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isSel}
            onClick={() => onDraftChange({ ...draft, selected: [opt.id] })}
            className={[
              'group relative flex flex-col overflow-hidden rounded-xl border text-left transition',
              isSel
                ? 'border-[color:var(--ask-accent)] ring-2 ring-[color:var(--ask-accent-line)]'
                : 'border-white/10 hover:border-white/25',
            ].join(' ')}
          >
            {opt.imageUrl ? (
              <img
                src={opt.imageUrl}
                alt={opt.label}
                loading="lazy"
                decoding="async"
                className="aspect-video w-full object-cover"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-white/5 text-white/40">
                <span className="ask-mono text-xs">no preview</span>
              </div>
            )}
            <span className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-white/85">
              <span className="truncate">{opt.label}</span>
              {isSel ? <CheckCircle size={16} weight="fill" className="shrink-0 text-[color:var(--ask-accent)]" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function QuestionKindControl({
  question,
  draft,
  onDraftChange,
  controlId,
}: {
  question: Question;
  draft: QuestionDraft;
  onDraftChange: (next: QuestionDraft) => void;
  controlId: string;
}) {
  switch (question.kind) {
    case 'single':
      return (
        <Radio.Group
          value={draft.selected[0] ?? ''}
          onValueChange={(v) => onDraftChange({ ...draft, selected: v ? [String(v)] : [] })}
          appearance="card"
        >
          <Radio.Legend className="sr-only">{question.title}</Radio.Legend>
          {question.options.map((opt) => (
            <Radio.Item key={opt.id} value={opt.id} label={opt.label} description={opt.description} />
          ))}
        </Radio.Group>
      );
    case 'multiple':
      return (
        <div role="group" aria-label={question.title} className="flex flex-col gap-2">
          {question.options.map((opt) => {
            const checked = draft.selected.includes(opt.id);
            return (
              <Checkbox
                key={opt.id}
                label={opt.label}
                checked={checked}
                onCheckedChange={(next) =>
                  onDraftChange({
                    ...draft,
                    selected: next
                      ? [...draft.selected, opt.id]
                      : draft.selected.filter((s) => s !== opt.id),
                  })
                }
              />
            );
          })}
        </div>
      );
    case 'short_text':
      return (
        <Input
          id={controlId}
          aria-label={question.title}
          placeholder="Type your answer"
          value={draft.text}
          onChange={(e) => onDraftChange({ ...draft, text: e.currentTarget.value })}
        />
      );
    case 'long_text':
      return (
        <InputArea
          id={controlId}
          aria-label={question.title}
          placeholder="Type your answer"
          autoResize
          minRows={3}
          maxRows={12}
          value={draft.text}
          onValueChange={(v) => onDraftChange({ ...draft, text: v })}
        />
      );
    case 'number':
      return (
        <Input
          id={controlId}
          aria-label={question.title}
          type="number"
          inputMode="decimal"
          placeholder={
            question.numberConstraint?.unit ? `Value in ${question.numberConstraint.unit}` : 'Enter a number'
          }
          min={question.numberConstraint?.min}
          max={question.numberConstraint?.max}
          step={question.numberConstraint?.step}
          value={draft.number}
          onChange={(e) => onDraftChange({ ...draft, number: e.currentTarget.value })}
        />
      );
    case 'range': {
      const c = question.numberConstraint;
      const min = c?.min ?? 0;
      const max = c?.max ?? 100;
      const cur = Number(draft.number || String(min));
      const fill = max > min ? Math.round(((cur - min) / (max - min)) * 100) : 0;
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <input
              id={controlId}
              type="range"
              aria-label={question.title}
              className="ask-range w-full"
              style={{ ['--ask-range-fill' as string]: String(fill) }}
              min={min}
              max={max}
              step={c?.step ?? 1}
              value={draft.number || String(min)}
              onChange={(e) => onDraftChange({ ...draft, number: e.currentTarget.value })}
            />
            <output className="ask-mono min-w-[3.5ch] text-right text-sm font-semibold text-[color:var(--ask-accent)]">
              {draft.number || String(min)}
              {c?.unit ? ` ${c.unit}` : ''}
            </output>
          </div>
          <div className="flex justify-between text-[0.7rem] text-white/40">
            <span className="ask-mono">
              {min}
              {c?.unit ? ` ${c.unit}` : ''}
            </span>
            <span className="ask-mono">
              {max}
              {c?.unit ? ` ${c.unit}` : ''}
            </span>
          </div>
        </div>
      );
    }
    case 'link':
      return (
        <Input
          id={controlId}
          aria-label={question.title}
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={draft.link}
          onChange={(e) => onDraftChange({ ...draft, link: e.currentTarget.value })}
        />
      );
    case 'image_comparison':
      return <ImageComparison question={question} draft={draft} onDraftChange={onDraftChange} />;
    default:
      return (
        <InputArea
          id={controlId}
          aria-label={question.title}
          placeholder="Describe your choice"
          autoResize
          minRows={2}
          value={draft.text}
          onValueChange={(v) => onDraftChange({ ...draft, text: v })}
        />
      );
  }
}

/** Build the discriminated AnswerValue from the current draft, or undefined if empty. */
function draftToValue(question: Question, draft: QuestionDraft): AnswerValue | undefined {
  switch (question.kind) {
    case 'single':
    case 'multiple':
    case 'image_comparison':
      return draft.selected.length ? { kind: 'choice', selected: draft.selected } : undefined;
    case 'short_text':
    case 'long_text':
      return draft.text.trim() ? { kind: 'text', text: draft.text.trim() } : undefined;
    case 'number':
    case 'range': {
      const n = Number(draft.number);
      return draft.number !== '' && Number.isFinite(n) ? { kind: 'number', value: n } : undefined;
    }
    case 'link':
      return draft.link.trim() ? { kind: 'link', url: draft.link.trim() } : undefined;
    default:
      return draft.text.trim() ? { kind: 'text', text: draft.text.trim() } : undefined;
  }
}

/** True when the kind's PRIMARY input is a free-text field (so we don't double-render a note). */
function kindIsFreeText(kind: Question['kind']): boolean {
  return kind === 'short_text' || kind === 'long_text';
}

export function QuestionCard({
  question,
  answer,
  pending,
  draft,
  onDraftChange,
  onSubmit,
  onExplainMore,
  compact = false,
  autoFocus,
}: Props) {
  const controlId = useId();
  const [explainState, setExplainState] = useState<'idle' | 'asking' | 'requested' | 'sent'>('idle');
  const value = draftToValue(question, draft);
  const freeText = draft.text.trim() || undefined;
  const sending = pending?.status === 'sending';
  const hasInput = value !== undefined || Boolean(freeText);
  const chip = answer ? answerStatusChip(answer.status) : undefined;
  // An unsent draft = the user has typed/selected something but there's no saved answer yet.
  const isUnsentDraft = hasInput && !answer && !sending;

  const explain = async () => {
    if (explainState === 'asking') return;
    setExplainState('asking');
    const accepted = await onExplainMore();
    setExplainState(accepted ? 'sent' : 'requested');
  };

  return (
    <Card
      as="article"
      interactive={!compact}
      glow={question.blocksWork}
      data-testid="question-card"
      data-question-id={question.id}
      aria-label={question.title}
      className={[
        'ask-enter flex flex-col gap-4',
        compact ? 'p-5 sm:p-6' : 'p-5',
        isUnsentDraft ? 'ask-draft pl-[18px]' : '',
      ].join(' ')}
    >
      <header className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {question.blocksWork ? (
            <Badge variant="warning" icon={Warning}>
              Blocks work
            </Badge>
          ) : (
            <Badge variant="outline">Work continues without this</Badge>
          )}
          {chip ? (
            <Tooltip content={chip.hint}>
              <span data-testid="status-chip">
                <Badge variant={chip.variant}>{chip.label}</Badge>
              </span>
            </Tooltip>
          ) : null}
          {isUnsentDraft ? (
            <Badge variant="beta" icon={PencilLine}>
              Draft — not sent
            </Badge>
          ) : null}
          {pending?.status === 'error' ? <Badge variant="error">Not saved — retry</Badge> : null}
        </div>

        {/* Line 1 — the question. */}
        <Heading level={3} className={compact ? 'text-xl' : 'text-lg'}>
          {question.title}
        </Heading>

        {/* Line 2 — why it matters now. */}
        {question.context ? (
          <MetaLine label="Why it matters:" icon={<Lightbulb size={15} weight="fill" />}>
            {question.context}
          </MetaLine>
        ) : null}

        {/* Line 3 — what different answers change. */}
        {question.consequence ? (
          <MetaLine label="What your answer changes:">{question.consequence}</MetaLine>
        ) : null}
      </header>

      {/* Line 4 — the recommendation, labeled as a suggestion, explicitly NOT pre-selected. */}
      {question.recommendation ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-[color:var(--ask-accent-line)] bg-[color:var(--ask-accent-soft)] px-3.5 py-2.5">
          <Sparkle size={16} weight="fill" className="mt-0.5 shrink-0 text-[color:var(--ask-accent)]" />
          <p className="text-[0.9rem] leading-relaxed text-white/80">
            <span className="font-semibold text-[color:var(--ask-accent)]">Suggested: </span>
            {question.recommendation}
            <span className="text-white/45"> — a hint, not selected for you.</span>
          </p>
        </div>
      ) : null}

      {/* Kind-appropriate input. */}
      <div {...(autoFocus ? { 'data-autofocus': 'true' } : {})}>
        <QuestionKindControl
          question={question}
          draft={draft}
          onDraftChange={onDraftChange}
          controlId={controlId}
        />
      </div>

      {/* A free-text note is always available alongside the structured input. */}
      {!kindIsFreeText(question.kind) ? (
        <InputArea
          aria-label={`Add a note for: ${question.title}`}
          placeholder="Add a note (optional)"
          autoResize
          minRows={1}
          maxRows={6}
          value={draft.text}
          onValueChange={(v) => onDraftChange({ ...draft, text: v })}
        />
      ) : null}

      <footer className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="primary"
          icon={PaperPlaneTilt}
          loading={sending}
          disabled={sending || !hasInput}
          data-testid="answer-submit"
          onClick={() => onSubmit(value, freeText)}
        >
          <span className="min-w-[6.5ch] text-center">{sending ? 'Saving…' : 'Submit answer'}</span>
        </Button>
        <Tooltip
          content="The agent chooses within the constraints you've stated."
          render={
            <Button
              variant="ghost"
              icon={Sparkle}
              disabled={sending}
              data-testid="answer-delegate"
              onClick={() => onSubmit({ kind: 'delegate' }, freeText)}
            />
          }
        >
          Let the agent decide
        </Tooltip>
        <Button
          variant="ghost"
          icon={HandPalm}
          disabled={sending}
          data-testid="answer-skip"
          onClick={() => onSubmit({ kind: 'skip' }, freeText)}
        >
          Skip for now
        </Button>
        <Button
          variant="ghost"
          icon={ChatCircleDots}
          loading={explainState === 'asking'}
          disabled={explainState === 'asking'}
          data-testid="answer-explain"
          onClick={() => void explain()}
        >
          {explainState === 'sent'
            ? 'Asked ✓'
            : explainState === 'requested'
              ? 'Requested'
              : 'Explain more'}
        </Button>
      </footer>

      {/* Honest note when Explain-more isn't wired yet (501). */}
      {explainState === 'requested' ? (
        <p className="ask-mono text-[0.72rem] text-white/45">
          Requested — the agent will add more detail here when it supports context requests.
        </p>
      ) : null}

      {/* When saved, echo the committed answer so the card reflects server truth. */}
      {answer && !isUnsentDraft ? (
        <p className="text-[0.8rem] text-white/50">
          Your answer: <Mono>{summarizeAnswer(answer)}</Mono>
        </p>
      ) : null}
    </Card>
  );
}

/** Short human summary of a saved answer revision for the "Your answer" echo. */
function summarizeAnswer(a: AnswerRevision): string {
  if (a.text && !a.value) return a.text;
  const v = a.value;
  if (!v) return a.text ?? '—';
  switch (v.kind) {
    case 'choice':
      return v.selected.join(', ');
    case 'text':
      return v.text;
    case 'number':
      return String(v.value);
    case 'link':
      return v.url;
    case 'delegate':
      return 'Delegated to the agent';
    case 'skip':
      return 'Skipped';
    default:
      return a.text ?? '—';
  }
}
