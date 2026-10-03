/**
 * Maps answer lifecycle + agent status to Kumo Badge variants and human labels
 * (§5). Variants come straight from Kumo's token set; every one of the 8 answer
 * statuses gets a DISTINCT, legible variant so they never read alike on dark.
 */
import type { AnswerStatus } from '@ask/contracts';

type BadgeVariant =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'info'
  | 'warning'
  | 'error'
  | 'neutral'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'beta'
  | 'outline';

export interface StatusChip {
  label: string;
  variant: BadgeVariant;
  /** A one-line plain-English meaning, surfaced as a tooltip/aria description. */
  hint: string;
}

/**
 * Per-answer status chip (§5). The 8 statuses map to 8 visually-distinct variants:
 * saved→secondary · downloaded→info(blue) · applied→teal · verified→success(green)
 * · needs_clarification→warning · superseded→purple · deferred→outline · could_not_apply→error.
 */
export function answerStatusChip(status: AnswerStatus): StatusChip {
  switch (status) {
    case 'answer_saved':
      return { label: 'Saved', variant: 'secondary', hint: 'Durably committed on the server.' };
    case 'agent_downloaded':
      return {
        label: 'Downloaded',
        variant: 'blue',
        hint: 'An enrolled agent stored this exact revision.',
      };
    case 'applied_to_project':
      return {
        label: 'Applied',
        variant: 'teal',
        hint: 'The agent reports files or behavior changed.',
      };
    case 'verified':
      return {
        label: 'Verified',
        variant: 'success',
        hint: 'The agent validated the change (self-reported).',
      };
    case 'needs_clarification':
      return {
        label: 'Needs clarification',
        variant: 'warning',
        hint: 'The agent needs more detail to proceed.',
      };
    case 'superseded':
      return {
        label: 'Superseded',
        variant: 'purple',
        hint: 'Replaced by a newer answer revision.',
      };
    case 'deferred':
      return {
        label: 'Deferred',
        variant: 'outline',
        hint: 'Set aside for later — not blocking work.',
      };
    case 'could_not_apply':
      return {
        label: 'Could not apply',
        variant: 'error',
        hint: 'The agent tried but could not apply it.',
      };
    default:
      return { label: status, variant: 'neutral', hint: '' };
  }
}

/** Agent working/waiting/offline chip. */
export function agentStatusChip(status: 'working' | 'waiting' | 'offline'): StatusChip {
  switch (status) {
    case 'working':
      return {
        label: 'Working',
        variant: 'success',
        hint: 'The agent is actively making progress.',
      };
    case 'waiting':
      return {
        label: 'Waiting on you',
        variant: 'warning',
        hint: 'The agent is blocked on an answer.',
      };
    case 'offline':
      return { label: 'Offline', variant: 'neutral', hint: 'No recent check-in from the agent.' };
  }
}
