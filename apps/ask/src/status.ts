/**
 * Maps answer lifecycle + agent status to Kumo Badge variants and human labels
 * (§5). Badge variants come straight from Kumo's token set.
 */
import type { AnswerStatus } from '@ask/contracts';

type BadgeVariant = 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'secondary' | 'teal';

export interface StatusChip {
  label: string;
  variant: BadgeVariant;
}

/** Per-answer status chip (§5). */
export function answerStatusChip(status: AnswerStatus): StatusChip {
  switch (status) {
    case 'answer_saved':
      return { label: 'Answer saved', variant: 'secondary' };
    case 'agent_downloaded':
      return { label: 'Agent downloaded', variant: 'info' };
    case 'applied_to_project':
      return { label: 'Applied to project', variant: 'teal' };
    case 'verified':
      return { label: 'Verified', variant: 'success' };
    case 'needs_clarification':
      return { label: 'Needs clarification', variant: 'warning' };
    case 'superseded':
      return { label: 'Superseded', variant: 'neutral' };
    case 'deferred':
      return { label: 'Deferred', variant: 'neutral' };
    case 'could_not_apply':
      return { label: 'Could not apply', variant: 'error' };
    default:
      return { label: status, variant: 'neutral' };
  }
}

/** Agent working/waiting/offline chip. */
export function agentStatusChip(status: 'working' | 'waiting' | 'offline'): StatusChip {
  switch (status) {
    case 'working':
      return { label: 'Working', variant: 'success' };
    case 'waiting':
      return { label: 'Waiting', variant: 'warning' };
    case 'offline':
      return { label: 'Offline', variant: 'neutral' };
  }
}
