/**
 * QuestionCard — one decision, rendered calmly (§5, §6).
 *
 * Shows: title, why-it-matters (context), what-answers-change (consequence),
 * the recommendation as a LABELED suggestion (never pre-selected), and a
 * "work continues without this" badge derived from `blocksWork`.
 *
 * Controls per kind: a kind-appropriate input + an always-available free-text
 * note + Skip for now + Let the agent decide (delegate) + Explain more.
 * Submitting is EXPLICIT. Draft state is owned by the parent and passed in, so
 * switching between cards never loses an unsent draft and a newly-arrived
 * question can't steal focus or reorder the card you're working on.
 */
import { useId } from 'react';
import { Badge, Button, Checkbox, Input, InputArea, Radio, Text } from '@cloudflare/kumo';
import {
  ChatCircleDots,
  HandPalm,
  Lightbulb,
  PaperPlaneTilt,
  Sparkle,
} from '@phosphor-icons/react';
import type { AnswerRevision, AnswerValue, Question } from '@ask/contracts';
import { answerStatusChip } from '../status';
import type { PendingAnswer } from '../useRoom';

/** Draft held in the parent, keyed by question id — survives card switches. */
export interface QuestionDraft {
  selected: string[]; // for single/multiple/range (single-element for single)
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
  onExplainMore: () => void;
  autoFocus?: boolean;
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
          placeholder={question.numberConstraint?.unit ? `Value in ${question.numberConstraint.unit}` : 'Enter a number'}
          min={question.numberConstraint?.min}
          max={question.numberConstraint?.max}
          step={question.numberConstraint?.step}
          value={draft.number}
          onChange={(e) => onDraftChange({ ...draft, number: e.currentTarget.value })}
        />
      );
    case 'range': {
      const c = question.numberConstraint;
      return (
        <div className="flex flex-col gap-1">
          <input
            id={controlId}
            type="range"
            aria-label={question.title}
            className="w-full accent-[#00e5ff]"
            min={c?.min ?? 0}
            max={c?.max ?? 100}
            step={c?.step ?? 1}
            value={draft.number || String(c?.min ?? 0)}
            onChange={(e) => onDraftChange({ ...draft, number: e.currentTarget.value })}
          />
          <Text variant="secondary" size="sm">
            {draft.number || String(c?.min ?? 0)}
            {c?.unit ? ` ${c.unit}` : ''}
          </Text>
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
    default:
      // image_comparison and any future kind fall back to a free-text answer.
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

export function QuestionCard({
  question,
  answer,
  pending,
  draft,
  onDraftChange,
  onSubmit,
  onExplainMore,
  autoFocus,
}: Props) {
  const controlId = useId();
  const value = draftToValue(question, draft);
  const freeText = draft.text.trim() || undefined;
  const sending = pending?.status === 'sending';
  const hasInput = value !== undefined || Boolean(freeText);
  const chip = answer ? answerStatusChip(answer.status) : undefined;

  return (
    <article
      data-testid="question-card"
      data-question-id={question.id}
      aria-label={question.title}
      className="flex flex-col gap-4 rounded-xl border border-kumo-hairline bg-kumo-base/60 p-5"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {question.blocksWork ? (
            <Badge variant="warning">Blocks work</Badge>
          ) : (
            <Badge variant="secondary">Work continues without this</Badge>
          )}
          {chip ? <Badge variant={chip.variant}>{chip.label}</Badge> : null}
          {pending?.status === 'error' ? <Badge variant="error">Not saved — retry</Badge> : null}
        </div>
        <Text as="h3" variant="heading">
          {question.title}
        </Text>
        {question.context ? (
          <Text variant="secondary" size="sm">
            <span className="font-medium text-kumo-default/80">Why it matters: </span>
            {question.context}
          </Text>
        ) : null}
        {question.consequence ? (
          <Text variant="secondary" size="sm">
            <span className="font-medium text-kumo-default/80">What your answer changes: </span>
            {question.consequence}
          </Text>
        ) : null}
      </header>

      {question.recommendation ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-[#00e5ff]/40 bg-[#00e5ff]/5 px-3 py-2">
          <Lightbulb size={16} weight="fill" className="mt-0.5 shrink-0 text-[#00e5ff]" />
          <Text variant="secondary" size="sm">
            <span className="font-medium text-kumo-default/90">Suggested: </span>
            {question.recommendation}
            <span className="text-kumo-default/50"> — not selected for you.</span>
          </Text>
        </div>
      ) : null}

      <div
        className={pending && !answer ? 'ask-draft rounded-md pl-3' : undefined}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        {...(autoFocus ? { 'data-autofocus': 'true' } : {})}
      >
        <QuestionKindControl
          question={question}
          draft={draft}
          onDraftChange={onDraftChange}
          controlId={controlId}
        />
      </div>

      {/* A free-text note is always available alongside the structured input. */}
      {question.kind !== 'short_text' && question.kind !== 'long_text' ? (
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

      <footer className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          icon={PaperPlaneTilt}
          loading={sending}
          disabled={sending || !hasInput}
          data-testid="answer-submit"
          onClick={() => onSubmit(value, freeText)}
        >
          {sending ? 'Saving…' : 'Submit answer'}
        </Button>
        <Button
          variant="ghost"
          icon={Sparkle}
          disabled={sending}
          title="Let the agent choose within your stated constraints"
          onClick={() => onSubmit({ kind: 'delegate' }, freeText)}
        >
          Let the agent decide
        </Button>
        <Button
          variant="ghost"
          icon={HandPalm}
          disabled={sending}
          onClick={() => onSubmit({ kind: 'skip' }, freeText)}
        >
          Skip for now
        </Button>
        <Button variant="ghost" icon={ChatCircleDots} onClick={onExplainMore}>
          Explain more
        </Button>
      </footer>
    </article>
  );
}
