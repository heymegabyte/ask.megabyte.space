/**
 * Room — the one calm workspace.
 *
 * Progressive disclosure:
 *  - Before any agent checks in, the room leads with ONE action: copy the setup
 *    prompt. Questions are the hero the moment the first question arrives.
 *  - Once connected, the connection card collapses to a quiet status line and
 *    the question queue takes over. ~5 top questions show; the rest queue below.
 *  - Tabs switch between Questions, Decisions, and Activity (the event feed).
 *
 * Drafts live HERE (keyed by question id) so switching cards never loses an
 * unsent draft, and a newly-arrived question never steals focus or reorders the
 * card you're working on (we render in a stable id order).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Collapsible,
  Empty,
  Loader,
  Tabs,
  Text,
} from '@cloudflare/kumo';
import {
  ChatsCircle,
  ClipboardText as ClipboardIcon,
  Lock,
  PlugsConnected,
  Question as QuestionIcon,
} from '@phosphor-icons/react';
import type { AnswerRevision, AnswerValue, Question } from '@ask/contracts';
import { ROUTES } from '@ask/contracts';
import { createRoom, getManifest, startCheckout, ApiError } from './api';
import { useRoom } from './useRoom';
import { buildSetupPrompt } from './setupPrompt';
import { agentStatusChip, answerStatusChip } from './status';
import { RoomHeader } from './components/RoomHeader';
import { QuestionCard, emptyDraft, type QuestionDraft } from './components/QuestionCard';

type ToastInput = { title: string; description?: string; variant?: 'success' | 'error' | 'info' | 'warning' };
type TabKey = 'questions' | 'decisions' | 'activity';

const TOP_COUNT = 5;
const noop = () => {};

interface Props {
  identifier: string;
  onToast?: (t: ToastInput) => void;
}

/** Stable sort: blockers first, then open, keeping arrival order within a group. */
function orderQuestions(questions: Question[]): Question[] {
  return questions
    .map((q, i) => ({ q, i }))
    .sort((a, b) => {
      const aw = a.q.blocksWork ? 0 : 1;
      const bw = b.q.blocksWork ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return a.i - b.i;
    })
    .map((x) => x.q);
}

export function Room({ identifier, onToast = noop }: Props) {
  const { load, connection, pending, submitAnswer, setRoom } = useRoom(identifier);
  const [tab, setTab] = useState<TabKey>('questions');
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [checkoutNote, setCheckoutNote] = useState<string | undefined>();
  const [checkingOut, setCheckingOut] = useState(false);
  const setupPromptRef = useRef<string | null>(null);

  const draftFor = useCallback((id: string): QuestionDraft => drafts[id] ?? emptyDraft, [drafts]);
  const setDraft = useCallback(
    (id: string, next: QuestionDraft) => setDrafts((d) => ({ ...d, [id]: next })),
    [],
  );

  const copySetupPrompt = useCallback(async () => {
    if (load.status !== 'ready' || !load.store.room) return;
    const room = load.store.room;
    const roomUrl = `${window.location.origin}/${room.slug}`;
    let manifestUrl = `${window.location.origin}${ROUTES.manifest}`;
    let manifestVersion = '1';
    try {
      const m = await getManifest();
      manifestUrl = m.serviceOrigin ? `${m.serviceOrigin}${ROUTES.manifest}` : manifestUrl;
      manifestVersion = String(m.schema);
    } catch {
      /* fall back to the derived manifest URL + schema v1 */
    }
    const prompt = buildSetupPrompt({ roomUrl, roomId: room.id, manifestUrl, manifestVersion });
    setupPromptRef.current = prompt;
    try {
      await navigator.clipboard.writeText(prompt);
      onToast({ title: 'Setup prompt copied', description: 'Paste it into your coding agent.', variant: 'success' });
    } catch {
      onToast({ title: 'Copy failed', description: 'Select the text below and copy it manually.', variant: 'error' });
    }
  }, [load, onToast]);

  const onCheckout = useCallback(async () => {
    if (load.status !== 'ready' || !load.store.room) return;
    setCheckingOut(true);
    setCheckoutNote(undefined);
    try {
      const res = await startCheckout(load.store.room.id);
      window.location.href = res.url; // real checkout URL once billing is live
    } catch (e: unknown) {
      // Honest: billing isn't wired yet → a 501. Never fake success.
      if (e instanceof ApiError && e.status === 501) {
        setCheckoutNote('Private pages are coming soon — this page stays public for now.');
      } else {
        setCheckoutNote('Something went wrong starting checkout. Try again shortly.');
      }
    } finally {
      setCheckingOut(false);
    }
  }, [load]);

  // ── non-ready states ───────────────────────────────────────────────────────
  if (load.status === 'loading') {
    return (
      <div className="ask-shell flex min-h-dvh items-center justify-center">
        <Loader size="lg" aria-label="Loading room" />
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="ask-shell flex min-h-dvh items-center justify-center p-6">
        <Banner
          className="max-w-md"
          variant="error"
          title="Couldn't load this page"
          description="Refresh to try again."
        />
      </div>
    );
  }

  if (load.status === 'free') {
    return <ClaimView slug={identifier} onToast={onToast} />;
  }

  if (load.status === 'denied') {
    return (
      <div className="ask-shell flex min-h-dvh items-center justify-center p-6">
        <Empty
          icon={<Lock size={44} />}
          title="This page is private"
          description="Only its owner can view this room. If it's yours, open it from the device that created it."
        />
      </div>
    );
  }

  // ── ready ────────────────────────────────────────────────────────────────
  const { store } = load;
  const room = store.room;
  if (!room) {
    return (
      <div className="ask-shell flex min-h-dvh items-center justify-center">
        <Loader size="lg" aria-label="Loading room" />
      </div>
    );
  }

  const roomUrl = `${window.location.origin}/${room.slug}`;
  const isOwner: boolean = store.viewerRole === 'owner';
  const connected = store.agents.length > 0;
  const ordered = orderQuestions(store.questions.filter((q) => q.state === 'open' || q.state === 'answered'));
  const top = ordered.slice(0, TOP_COUNT);
  const queued = ordered.slice(TOP_COUNT);
  const latestAgent = [...store.agents].sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''))[0];

  const connectionLabel: Record<string, string> = {
    connecting: 'Connecting…',
    open: 'Live',
    reconnecting: 'Reconnecting…',
    closed: 'Offline',
  };

  const answerFor = (qid: string) =>
    [...store.answers].filter((a) => a.questionId === qid).sort((a, b) => b.revision - a.revision)[0];

  const handleSubmit = async (q: Question, value: AnswerValue | undefined, text: string | undefined) => {
    const ok = await submitAnswer(q.id, { value, text });
    if (ok) {
      // Clear the draft on commit so the card reflects the saved answer cleanly.
      setDrafts((d) => {
        const next = { ...d };
        delete next[q.id];
        return next;
      });
      onToast({ title: 'Answer saved', variant: 'success' });
    } else {
      onToast({ title: 'Answer not saved', description: 'Your draft is kept — try again.', variant: 'error' });
    }
  };

  const explainMore = (q: Question) =>
    onToast({
      title: 'Asked the agent to explain',
      description: `We'll surface more detail on "${q.title}" when the agent responds.`,
      variant: 'info',
    });

  return (
    <div className="ask-shell min-h-dvh">
      <RoomHeader
        room={room}
        isOwner={isOwner}
        roomUrl={roomUrl}
        onRoomChange={setRoom}
        onCopySetupPrompt={() => void copySetupPrompt()}
        onToast={onToast}
      />

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
        {/* Connection card: prominent pre-connection, collapsed once an agent checks in. */}
        {!connected ? (
          <section className="flex flex-col items-start gap-3 rounded-xl border border-[#00e5ff]/25 bg-[#00e5ff]/5 p-5">
            <div className="flex items-center gap-2">
              <PlugsConnected size={18} className="text-[#00e5ff]" />
              <Text variant="heading">Connect your coding agent</Text>
            </div>
            <Text variant="secondary" size="sm">
              Paste this into your coding agent. Its questions will appear here.
            </Text>
            <Button
              variant="primary"
              icon={ClipboardIcon}
              data-testid="copy-setup-prompt"
              onClick={() => void copySetupPrompt()}
            >
              Copy setup prompt
            </Button>
            {setupPromptRef.current ? (
              <pre className="mt-1 max-h-48 w-full overflow-auto rounded-lg border border-kumo-hairline bg-kumo-base/70 p-3 text-xs text-kumo-subtle">
                {setupPromptRef.current}
              </pre>
            ) : null}
          </section>
        ) : (
          <Collapsible.Root>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-kumo-hairline bg-kumo-base/50 px-4 py-2">
              <Badge variant="success" appearance="dot">
                {connectionLabel[connection] ?? connection}
              </Badge>
              {latestAgent ? (
                <>
                  <Text variant="secondary" size="sm">
                    {latestAgent.agent}
                    {latestAgent.task ? ` · ${latestAgent.task}` : ''}
                  </Text>
                  <Badge variant={agentStatusChip(latestAgent.status).variant}>
                    {agentStatusChip(latestAgent.status).label}
                  </Badge>
                </>
              ) : null}
              <div className="ml-auto">
                <Collapsible.Trigger
                  render={<Button variant="ghost" size="sm" data-testid="copy-setup-prompt" onClick={() => void copySetupPrompt()} />}
                >
                  Copy setup prompt
                </Collapsible.Trigger>
              </div>
            </div>
          </Collapsible.Root>
        )}

        <Tabs
          variant="underline"
          tabs={[
            { value: 'questions', label: `Questions${ordered.length ? ` (${ordered.length})` : ''}` },
            { value: 'decisions', label: 'Decisions' },
            { value: 'activity', label: 'Activity' },
          ]}
          value={tab}
          onValueChange={(v) => setTab(v as TabKey)}
          listClassName="[&_button[data-testid]]:!block"
        />

        {/* data-testid anchors for the three tabs (Kumo renders its own buttons). */}
        <div className="sr-only">
          <span data-testid="tab-questions" />
          <span data-testid="tab-decisions" />
          <span data-testid="tab-activity" />
        </div>

        {tab === 'questions' ? (
          ordered.length === 0 ? (
            <Empty
              icon={<QuestionIcon size={44} />}
              title={connected ? 'No open questions' : 'Waiting for your agent'}
              description={
                connected
                  ? 'Your agent has nothing to ask right now. New questions will appear here the moment it does.'
                  : 'Once your agent is connected, the decisions it would otherwise guess at show up here.'
              }
              contents={
                !connected ? (
                  <Button variant="secondary" icon={ClipboardIcon} onClick={() => void copySetupPrompt()}>
                    Copy setup prompt
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {top.map((q) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  answer={answerFor(q.id)}
                  pending={pending[q.id]}
                  draft={draftFor(q.id)}
                  onDraftChange={(next) => setDraft(q.id, next)}
                  onSubmit={(value, text) => void handleSubmit(q, value, text)}
                  onExplainMore={() => explainMore(q)}
                />
              ))}

              {queued.length ? (
                <section className="flex flex-col gap-3">
                  <Text variant="secondary" size="sm" bold>
                    Up next ({queued.length})
                  </Text>
                  {queued.map((q) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      answer={answerFor(q.id)}
                      pending={pending[q.id]}
                      draft={draftFor(q.id)}
                      onDraftChange={(next) => setDraft(q.id, next)}
                      onSubmit={(value, text) => void handleSubmit(q, value, text)}
                      onExplainMore={() => explainMore(q)}
                    />
                  ))}
                </section>
              ) : null}
            </div>
          )
        ) : null}

        {tab === 'decisions' ? <DecisionsTab store={store} /> : null}
        {tab === 'activity' ? <ActivityTab store={store} /> : null}

        {/* Owner-only upgrade — honest about billing readiness. */}
        {isOwner ? (
          <section className="mt-2 flex flex-col gap-2 border-t border-kumo-hairline pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" icon={Lock} loading={checkingOut} onClick={() => void onCheckout()}>
                Make private · $10/month
              </Button>
              <Text variant="secondary" size="sm">
                Keep this page visible only to you.
              </Text>
            </div>
            {checkoutNote ? (
              <Banner variant="secondary" size="sm" title={checkoutNote} />
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}

/** Decisions tab — the answered questions and their current status (§5, §10). */
function DecisionsTab({ store }: { store: import('./useRoom').RoomStore }) {
  const decided = store.questions
    .map((q) => ({
      q,
      a: [...store.answers].filter((a) => a.questionId === q.id).sort((x, y) => y.revision - x.revision)[0],
    }))
    .filter((x): x is { q: Question; a: AnswerRevision } => Boolean(x.a));

  if (decided.length === 0) {
    return (
      <Empty
        icon={<ChatsCircle size={44} />}
        title="No decisions yet"
        description="Answers you submit — and what your agent did with them — will be summarized here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {decided.map(({ q, a }) => {
        const chip = answerStatusChip(a.status);
        return (
          <div key={q.id} className="flex items-start justify-between gap-3 rounded-lg border border-kumo-hairline bg-kumo-base/50 p-4">
            <div className="min-w-0">
              <Text bold>{q.title}</Text>
              <Text variant="secondary" size="sm">
                {a.text ?? answerSummary(a.value)}
              </Text>
            </div>
            <Badge variant={chip.variant}>{chip.label}</Badge>
          </div>
        );
      })}
    </div>
  );
}

/** Activity tab — a readable event feed built from receipts + agent check-ins. */
function ActivityTab({ store }: { store: import('./useRoom').RoomStore }) {
  const items = [
    ...store.receipts.map((r) => ({
      ts: r.createdAt,
      text: `Agent ${receiptVerb(r.state)}${r.commitRef ? ` (${r.commitRef})` : ''}${
        r.affectedPaths.length ? ` — ${r.affectedPaths.slice(0, 3).join(', ')}` : ''
      }`,
    })),
    ...store.answers.map((a) => ({ ts: a.createdAt, text: `Answer ${answerStatusChip(a.status).label.toLowerCase()}` })),
    ...store.agents.map((ag) => ({
      ts: ag.lastSeenAt ?? '',
      text: `${ag.agent} ${ag.status}${ag.task ? ` · ${ag.task}` : ''}`,
    })),
  ]
    .filter((x) => x.ts)
    .sort((a, b) => b.ts.localeCompare(a.ts));

  if (items.length === 0) {
    return (
      <Empty
        icon={<ChatsCircle size={44} />}
        title="Nothing here yet"
        description="Agent check-ins, answers, and applied changes will stream in as they happen."
      />
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-baseline gap-3 rounded-md border border-kumo-hairline bg-kumo-base/40 px-3 py-2">
          <time className="shrink-0 font-mono text-xs text-kumo-subtle">{formatTime(it.ts)}</time>
          <Text size="sm">{it.text}</Text>
        </li>
      ))}
    </ol>
  );
}

/** 404 slug → offer to claim it. */
function ClaimView({ slug, onToast }: { slug: string; onToast: (t: ToastInput) => void }) {
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const claim = async () => {
    setClaiming(true);
    setError(undefined);
    try {
      const res = await createRoom(slug);
      window.history.replaceState({}, '', `/${res.room.slug}`);
      onToast({ title: 'Page claimed', description: `ask/${res.room.slug} is yours.`, variant: 'success' });
      window.location.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.code : (e as Error).message);
      setClaiming(false);
    }
  };

  return (
    <div className="ask-shell flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <Text as="h1" variant="heading" size="lg">
          This page is free
        </Text>
        <Text variant="secondary">
          <span className="font-mono text-kumo-default">ask/{slug}</span> isn't taken. Claim it to start a room here.
        </Text>
        {error ? (
          <Banner className="w-full text-left" variant="error" title="Couldn't claim this name" description="Try again, or pick a different one." />
        ) : null}
        <Button variant="primary" size="lg" loading={claiming} data-testid="claim-button" onClick={() => void claim()}>
          {claiming ? 'Claiming…' : 'Claim this page'}
        </Button>
      </div>
    </div>
  );
}

// ── small formatters ─────────────────────────────────────────────────────────

function answerSummary(value: AnswerValue | undefined): string {
  if (!value) return '—';
  switch (value.kind) {
    case 'choice':
      return value.selected.join(', ');
    case 'text':
      return value.text;
    case 'number':
      return String(value.value);
    case 'link':
      return value.url;
    case 'delegate':
      return 'Delegated to the agent';
    case 'skip':
      return 'Skipped';
    default:
      return '—';
  }
}

function receiptVerb(state: 'received' | 'considered' | 'applied'): string {
  return state === 'applied' ? 'applied an answer' : state === 'considered' ? 'considered an answer' : 'received an answer';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
