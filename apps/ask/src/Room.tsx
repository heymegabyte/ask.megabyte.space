/**
 * Room — the one calm, gorgeous workspace.
 *
 * Progressive disclosure:
 *  - Before any agent checks in, the room leads with ONE action: copy the setup
 *    prompt (the empty state is a launchpad). Questions become the hero the moment
 *    the first one arrives.
 *  - Once connected, the connection card collapses to a quiet live status line
 *    (which agent · working/waiting/offline · branch/task · last check-in) and the
 *    question queue takes over. The 5 highest-value questions are "Now"; the rest
 *    form an ordered Next/Later queue below.
 *  - Mobile = one-question focus view (step through, with a rapid-answer rail).
 *    Desktop = the full compact list.
 *  - Tabs switch between Questions, Decisions (what the agent applied), and
 *    Activity (the live event feed).
 *
 * Drafts live HERE (keyed by question id) so switching cards never loses an unsent
 * draft, and a newly-arrived question never steals focus or reorders the active
 * card (we render in a stable id order; horizon only buckets, it never reshuffles).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Badge, Banner, Button, Loader, Tooltip } from '@cloudflare/kumo';
import {
  Archive,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  CaretRight,
  ChatsCircle,
  CheckCircle,
  ClipboardText as ClipboardIcon,
  GitBranch,
  Lightbulb,
  Lightning,
  Lock,
  PlugsConnected,
  Question as QuestionIcon,
  Receipt,
  Warning,
  WarningCircle,
  WifiSlash,
  X,
} from '@phosphor-icons/react';
import type {
  AnswerRevision,
  AnswerValue,
  ApplicationReceipt,
  Question,
  QuestionQuality,
} from '@ask/contracts';
import { ROUTES } from '@ask/contracts';
import {
  archiveQuestion,
  createRoom,
  getManifest,
  postContextRequest,
  postEnrich,
  startCheckout,
  ApiError,
} from './api';
import { useRoom, type RoomStore } from './useRoom';
import { buildSetupPrompt } from './setupPrompt';
import { agentStatusChip, answerStatusChip } from './status';
import { recordRecentPage } from './recentPages';
import { RoomHeader } from './components/RoomHeader';
import { GetStartedPrompts } from './components/GetStartedPrompts';
import { ProjectUnderstanding } from './ProjectUnderstanding';
import { QuestionCard, emptyDraft, type QuestionDraft } from './components/QuestionCard';
import { useZenMode } from './eggs';
import {
  Card,
  Eyebrow,
  Heading,
  Mono,
  Muted,
  clockTime,
  relativeTime,
  slugAccentHue,
} from './components/ui';

type ToastInput = {
  title: string;
  description?: string;
  variant?: 'success' | 'error' | 'info' | 'warning';
};
type TabKey = 'questions' | 'decisions' | 'activity';

const TOP_COUNT = 5;
const noop = () => {};
const TAB_ORDER: TabKey[] = ['questions', 'decisions', 'activity'];

/** Egg 8 — whimsical-but-helpful empty-state lines (rotates deterministically). */
const VOID_LINES = [
  'Ask the void — your agent has nothing to ask right now. New questions appear here live.',
  'All quiet on the agent front. The moment it hits a fork in the road, it shows up here.',
  'No open questions. Somewhere, an agent is resisting the urge to guess. New ones land here.',
  'Inbox zero for your agent. When it needs a human call, this page updates instantly.',
];

/** Egg 4 — remember the first-answer celebration per room (once ever, this browser). */
function firstAnswerKey(roomId: string): string {
  return `ask.firstAnswer.${roomId}`;
}
function hasCelebratedFirstAnswer(roomId: string): boolean {
  try {
    return localStorage.getItem(firstAnswerKey(roomId)) === '1';
  } catch {
    return true; // private mode → never nag
  }
}
function markCelebratedFirstAnswer(roomId: string): void {
  try {
    localStorage.setItem(firstAnswerKey(roomId), '1');
  } catch {
    /* best-effort */
  }
}

/** Short human label per question kind — shown as a badge on collapsed queue rows. */
const KIND_LABEL: Record<Question['kind'], string> = {
  single: 'Choice',
  multiple: 'Multi',
  short_text: 'Text',
  long_text: 'Text',
  number: 'Number',
  range: 'Range',
  link: 'Link',
  image_comparison: 'Images',
};

interface Props {
  identifier: string;
  onToast?: (t: ToastInput) => void;
}

/** Stable sort: blockers first, then arrival order within a group. Never reshuffles
 *  mid-session (index is the tiebreak), so a new question can't move your active card. */
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

/** Bucket key for a question's source repo — `''` means "no repo" (the "This room" group). */
const NO_REPO = '';

/**
 * Group an ORDERED question list by `question.repo`, preserving the incoming order
 * both within and across groups (a group's rank = where its first question appears),
 * so grouping never reshuffles the active card. The no-repo bucket ("This room") is
 * included like any other. Returns `[repoKey, questions][]`.
 */
function groupByRepo(ordered: Question[]): Array<[string, Question[]]> {
  const groups = new Map<string, Question[]>();
  for (const q of ordered) {
    const key = q.repo ?? NO_REPO;
    const arr = groups.get(key);
    if (arr) arr.push(q);
    else groups.set(key, [q]);
  }
  return [...groups.entries()];
}

export function Room({ identifier, onToast = noop }: Props) {
  const { load, connection, pending, submitAnswer, setRoom, patchQuestion, refresh } =
    useRoom(identifier);
  const [tab, setTab] = useState<TabKey>('questions');
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [checkoutNote, setCheckoutNote] = useState<string | undefined>();
  const [checkingOut, setCheckingOut] = useState(false);
  const [focusMode, setFocusMode] = useState(false); // mobile one-question focus view
  const [focusIndex, setFocusIndex] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // which queued rows are open
  const [rescanning, setRescanning] = useState(false); // AI re-scan (§6) in flight
  const [showArchived, setShowArchived] = useState(false); // archived-questions disclosure (§6)
  const [archivingIds, setArchivingIds] = useState<Record<string, boolean>>({}); // in-flight archive/restore
  const [crossRepoDismissed, setCrossRepoDismissed] = useState(false); // dismissible mixed-repo banner
  const setupPromptRef = useRef<string | null>(null);
  const [setupPrompt, setSetupPrompt] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false); // egg 4 — first-answer pulse
  const zen = useZenMode(); // egg 5 — calm mode (hide chrome, center question)

  // Egg 4 — the first time this room has a committed answer, pulse once + microcopy.
  const committedAnswers = load.status === 'ready' ? load.store.answers.length : 0;
  useEffect(() => {
    if (load.status !== 'ready' || !load.store.room) return;
    const id = load.store.room.id;
    if (committedAnswers > 0 && !hasCelebratedFirstAnswer(id)) {
      markCelebratedFirstAnswer(id);
      setCelebrate(true);
      const t = window.setTimeout(() => setCelebrate(false), 3600);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [committedAnswers, load]);

  const draftFor = useCallback((id: string): QuestionDraft => drafts[id] ?? emptyDraft, [drafts]);
  const setDraft = useCallback(
    (id: string, next: QuestionDraft) => setDrafts((d) => ({ ...d, [id]: next })),
    [],
  );
  const toggleExpanded = useCallback(
    (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] })),
    [],
  );

  // Remember this page on this device (for the header's "recent pages" list).
  useEffect(() => {
    if (load.status === 'ready' && load.store.room) recordRecentPage(load.store.room.slug);
  }, [load]);

  const roomId = load.status === 'ready' ? load.store.room?.id : undefined;

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
    setSetupPrompt(prompt);
    try {
      await navigator.clipboard.writeText(prompt);
      onToast({
        title: 'Setup prompt copied',
        description: 'Paste it into your coding agent.',
        variant: 'success',
      });
    } catch {
      onToast({
        title: 'Copy failed',
        description: 'Select the text below and copy it manually.',
        variant: 'error',
      });
    }
  }, [load, onToast]);

  const copyLink = useCallback(async () => {
    if (load.status !== 'ready' || !load.store.room) return;
    const url = `${window.location.origin}/${load.store.room.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      onToast({ title: 'Link copied', description: url, variant: 'success' });
    } catch {
      onToast({ title: 'Copy failed', description: url, variant: 'error' });
    }
  }, [load, onToast]);

  const newPage = useCallback(async () => {
    try {
      const res = await createRoom();
      window.location.assign(`/${res.room.slug}`);
    } catch {
      onToast({
        title: "Couldn't open a new page",
        description: 'Try again in a moment.',
        variant: 'error',
      });
    }
  }, [onToast]);

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
        setCheckoutNote('coming-soon');
      } else {
        setCheckoutNote('error');
      }
    } finally {
      setCheckingOut(false);
    }
  }, [load]);

  const explainMore = useCallback(
    async (q: Question): Promise<boolean> => {
      if (!roomId) return false;
      try {
        const { accepted } = await postContextRequest(roomId, {
          questionId: q.id,
          kind: 'explain',
        });
        if (accepted) {
          onToast({
            title: 'Asked the agent to explain',
            description: `We'll surface more detail on "${q.title}" when it responds.`,
            variant: 'info',
          });
        }
        return accepted;
      } catch {
        onToast({
          title: "Couldn't send that request",
          description: 'Try again shortly.',
          variant: 'error',
        });
        return false;
      }
    },
    [roomId, onToast],
  );

  const rescan = useCallback(async () => {
    if (!roomId) return;
    setRescanning(true);
    try {
      const res = await postEnrich(roomId);
      if (res.ran) {
        // The DO also broadcasts enrichment.updated → the store merges it live.
        onToast({ title: 'Project summary refreshed', variant: 'success' });
      } else {
        const why: Record<string, string> = {
          disabled: 'AI summaries are turned off for now.',
          unavailable: 'The AI service isn’t available right now.',
          empty: 'Not enough questions yet to summarize.',
          budget: 'This page has reached its AI summary limit.',
          throttled: 'Just refreshed — try again in a moment.',
        };
        onToast({
          title: 'Nothing to refresh yet',
          description: why[res.reason ?? ''] ?? 'Try again shortly.',
          variant: 'info',
        });
      }
    } catch {
      onToast({
        title: 'Couldn’t refresh the summary',
        description: 'Try again shortly.',
        variant: 'error',
      });
    } finally {
      setRescanning(false);
    }
  }, [roomId, onToast]);

  // ── non-ready states ───────────────────────────────────────────────────────
  if (load.status === 'loading') {
    return (
      <div className="ask-shell flex min-h-dvh flex-col items-center justify-center gap-4">
        <Loader size="lg" aria-label="Loading room" />
        <Muted>Opening this page…</Muted>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="ask-shell flex min-h-dvh items-center justify-center p-6">
        <Card className="flex max-w-md flex-col items-center gap-4 p-8 text-center" glow>
          <WifiSlash size={40} className="text-[color:var(--ask-accent)]" />
          <Heading level={1} className="ask-h2">
            Couldn't load this page
          </Heading>
          <Muted className="text-center">
            Something went wrong reaching the server. Your work is safe.
          </Muted>
          <Button variant="primary" icon={ArrowClockwise} onClick={() => void refresh()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  if (load.status === 'free') {
    return <ClaimView slug={identifier} onToast={onToast} />;
  }

  if (load.status === 'denied') {
    return (
      <div className="ask-shell flex min-h-dvh items-center justify-center p-6">
        <Card className="flex max-w-md flex-col items-center gap-4 p-8 text-center" glow>
          <Lock size={40} className="text-[color:var(--ask-accent)]" />
          <Heading level={1} className="ask-h2">
            This page is private
          </Heading>
          <Muted className="text-center">
            Only its owner can view this room. If it's yours, open it from the device that created
            it.
          </Muted>
          <Button variant="outline" onClick={() => window.location.assign('/')}>
            Start a new page
          </Button>
        </Card>
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
  const accentHue = slugAccentHue(room.slug);

  // Archived questions are kept out of the active Now/Next queue (§6); they live in a
  // collapsed disclosure below. Everything else (open/answered) forms the active list.
  const open = store.questions.filter((q) => q.state === 'open' || q.state === 'answered');
  const ordered = orderQuestions(open);
  const archivedQuestions = store.questions.filter((q) => q.state === 'archived');
  const latestAgent = [...store.agents].sort((a, b) =>
    (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''),
  )[0];

  // Cross-repo warning (§28-ext): the room mixes questions from ≥2 distinct repos, OR
  // mixes repo-stamped with un-repo'd questions (a connected folder that isn't a git repo).
  // Computed over ALL non-archived questions so archiving a stray clears the banner.
  const distinctRepos = new Set(open.map((q) => q.repo).filter((r): r is string => Boolean(r)));
  const hasUnrepoed = open.some((q) => !q.repo);
  const mixedRepos = distinctRepos.size >= 2 || (distinctRepos.size >= 1 && hasUnrepoed);

  const answeredIds = new Set(store.answers.map((a) => a.questionId));
  const unanswered = ordered.filter((q) => !answeredIds.has(q.id)).length;

  // AI quality verdicts, keyed by question id — drives the subtle "could be sharper" hint (§6).
  const qualityByQuestion = new Map<string, QuestionQuality>(
    (store.questionQuality ?? []).map((q) => [q.questionId, q]),
  );

  const answerFor = (qid: string) =>
    [...store.answers]
      .filter((a) => a.questionId === qid)
      .sort((a, b) => b.revision - a.revision)[0];

  const handleSubmit = async (
    q: Question,
    value: AnswerValue | undefined,
    text: string | undefined,
  ) => {
    const ok = await submitAnswer(q.id, { value, text });
    if (ok) {
      setDrafts((d) => {
        const next = { ...d };
        delete next[q.id];
        return next;
      });
      const kind = value?.kind;
      onToast({
        title:
          kind === 'skip'
            ? 'Skipped for now'
            : kind === 'delegate'
              ? 'Delegated to the agent'
              : 'Answer saved',
        variant: 'success',
      });
      // In focus mode, advance to the next unanswered card automatically.
      if (focusMode) setFocusIndex((i) => Math.min(i + 1, Math.max(0, ordered.length - 1)));
    } else {
      onToast({
        title: 'Answer not saved',
        description: 'Your draft is kept — try again.',
        variant: 'error',
      });
    }
  };

  /**
   * Owner archives (or restores) a question (§6). Optimistic: flip the question's state
   * locally at once, call the server, then reconcile with the authoritative entity it
   * returns; the DO also broadcasts `question.updated` so other clients follow. On
   * failure, revert to the prior question and surface a toast.
   */
  const setArchived = async (q: Question, archived: boolean, reason?: string) => {
    if (!room) return;
    setArchivingIds((m) => ({ ...m, [q.id]: true }));
    const previous = q;
    // Optimistic local state flip (reason shown immediately when archiving).
    patchQuestion({
      ...q,
      state: archived ? 'archived' : 'open',
      archiveReason: archived ? (reason ?? q.archiveReason) : undefined,
    });
    try {
      const updated = await archiveQuestion(room.id, q.id, archived);
      patchQuestion(updated); // reconcile with the server's authoritative entity
      onToast({ title: archived ? 'Question archived' : 'Question restored', variant: 'success' });
    } catch {
      patchQuestion(previous); // revert the optimistic change
      onToast({
        title: archived ? "Couldn't archive" : "Couldn't restore",
        description: 'Try again in a moment.',
        variant: 'error',
      });
    } finally {
      setArchivingIds((m) => {
        const next = { ...m };
        delete next[q.id];
        return next;
      });
    }
  };

  const renderCard = (q: Question, compact = false, emphasis = false) => {
    // Subtle, non-noisy "could be sharper" hint — only for a still-open question the
    // AI flagged lame AND that carries a concrete suggestion (§6). Never for answered.
    const quality = qualityByQuestion.get(q.id);
    const showHint = Boolean(
      quality?.lame && quality.improvement.trim() && q.state === 'open' && !answerFor(q.id),
    );
    // Appropriateness/staleness warning (§6): the AI judges this OPEN question a poor
    // fit for the project OR overtaken by events. Owner gets a one-tap Archive.
    const showFitWarning = Boolean(
      q.state === 'open' && quality && (quality.appropriate === false || quality.stale),
    );
    return (
      <div key={q.id} className="flex flex-col gap-1.5">
        <QuestionCard
          question={q}
          answer={answerFor(q.id)}
          pending={pending[q.id]}
          draft={draftFor(q.id)}
          compact={compact}
          emphasis={emphasis}
          onDraftChange={(next) => setDraft(q.id, next)}
          onSubmit={(value, text) => void handleSubmit(q, value, text)}
          onExplainMore={() => explainMore(q)}
        />
        {showFitWarning ? (
          <FitWarning
            concern={quality!.concern}
            canArchive={isOwner}
            archiving={Boolean(archivingIds[q.id])}
            onArchive={() => void setArchived(q, true, quality!.concern || undefined)}
          />
        ) : null}
        {showHint ? <SharperHint improvement={quality!.improvement} /> : null}
      </div>
    );
  };

  /** One collapsed "Next & later" row (auto-opens when it has a saved answer or a live draft). */
  const renderQueueRow = (q: Question) => {
    const hasAnswer = Boolean(answerFor(q.id));
    const draft = draftFor(q.id);
    const hasDraft = Boolean(
      draft.selected.length || draft.text.trim() || draft.number || draft.link.trim(),
    );
    const isOpen = expanded[q.id] || hasAnswer || hasDraft;
    return isOpen ? (
      renderCard(q)
    ) : (
      <QueueRow
        key={q.id}
        question={q}
        answered={hasAnswer}
        onExpand={() => toggleExpanded(q.id)}
      />
    );
  };

  /**
   * Render an ordered question set as the Now (top N) + Next & later queue. Used both
   * for the flat single-repo list AND for each per-repo group, so progressive disclosure,
   * answered-on-reload, and live-merge behavior are identical in every path.
   * `showNowLabel` keeps the "Now — N to decide" eyebrow off per-group blocks (the group
   * header already names the section) while keeping it for the flat list.
   */
  const renderOrderedList = (list: Question[], showNowLabel = true) => {
    const nowList = list.slice(0, TOP_COUNT);
    const laterList = list.slice(TOP_COUNT);
    return (
      <>
        <section className="flex flex-col gap-4">
          {showNowLabel ? <Eyebrow>Now — {nowList.length} to decide</Eyebrow> : null}
          {nowList.map((q) => renderCard(q, false, true))}
        </section>
        {laterList.length ? (
          <section data-zen-hide className="flex flex-col gap-2">
            <Eyebrow>Next &amp; later · {laterList.length}</Eyebrow>
            {laterList.map((q) => renderQueueRow(q))}
          </section>
        ) : null}
      </>
    );
  };

  // Group the ordered questions by their source repo. Headers render ONLY when ≥2
  // distinct repos are present; otherwise the list stays flat (unchanged behavior).
  const repoGroups = groupByRepo(ordered);
  const grouped = repoGroups.length >= 2;

  const focusQ = ordered[Math.min(focusIndex, Math.max(0, ordered.length - 1))];

  return (
    <div
      className="ask-shell min-h-dvh"
      style={{ ['--ask-accent-h' as string]: String(accentHue) }}
      aria-live="off"
    >
      <div data-zen-hide>
        <RoomHeader
          room={room}
          isOwner={isOwner}
          roomUrl={roomUrl}
          onRoomChange={setRoom}
          onCopySetupPrompt={() => void copySetupPrompt()}
          onCopyLink={() => void copyLink()}
          onNewPage={() => void newPage()}
          onToast={onToast}
        />
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div data-zen-hide className="flex flex-col gap-5">
          <ConnectionPanel
            connected={connected}
            connection={connection}
            latestAgent={latestAgent}
            setupPrompt={setupPrompt}
            onCopySetupPrompt={() => void copySetupPrompt()}
          />

          {/* Both get-started prompts (repo-scoped + global) right on the room, so the
              owner can wire a new agent/repo or make Ask permanent without leaving (§22). */}
          <SetupPromptsSection room={room} connected={connected} onToast={onToast} />

          {/* AI read of the project (§6) — renders only once there's a real summary.
              Owner gets a quiet re-scan; it updates live as answers arrive. */}
          <ProjectUnderstanding
            understanding={store.understanding}
            onRescan={isOwner ? () => void rescan() : undefined}
            rescanning={rescanning}
          />

          {/* Reconnecting ribbon — the WS dropped but we're retrying; state isn't lost. */}
          {connected && (connection === 'reconnecting' || connection === 'closed') ? (
            <div
              role="status"
              data-testid="connection-reconnecting"
              className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-sm text-amber-200"
            >
              <ArrowClockwise size={15} className="animate-spin" />
              {connection === 'closed'
                ? 'Connection lost — reconnecting…'
                : 'Reconnecting to live updates…'}
            </div>
          ) : null}

          {/* Cross-repo warning (§28-ext): questions span ≥2 repos, or mix repo'd +
              un-repo'd. Dismissible, amber, near the top — nudges one git repo per page. */}
          {mixedRepos && !crossRepoDismissed ? (
            <div
              role="status"
              data-testid="cross-repo-warning"
              className="flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200"
            >
              <Warning size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1 leading-relaxed">
                Questions from multiple repositories are mixed on this page. Connect one git repo
                per page (
                <span className="ask-mono text-amber-100">questionl.ink/owner/repo</span>) to
                keep them separate.
              </p>
              <Button
                variant="ghost"
                size="sm"
                shape="square"
                icon={X}
                aria-label="Dismiss cross-repository warning"
                data-testid="cross-repo-dismiss"
                className="-mr-1 shrink-0"
                onClick={() => setCrossRepoDismissed(true)}
              />
            </div>
          ) : null}
        </div>

        {/* Egg 4 — restrained first-answer celebration (once per room). */}
        {celebrate ? (
          <div
            role="status"
            data-testid="first-answer-celebrate"
            className="ask-celebrate ask-enter flex items-center gap-2.5 rounded-xl border border-[color:var(--ask-accent-line)] bg-[color:var(--ask-accent-soft)] px-4 py-2.5 text-sm text-white/85"
          >
            <CheckCircle
              size={16}
              weight="fill"
              className="shrink-0 text-[color:var(--ask-accent)]"
              aria-hidden="true"
            />
            First answer in — your agent is listening.
          </div>
        ) : null}

        <div data-zen-hide className="flex items-center justify-between gap-3">
          <RoomTabs
            tab={tab}
            onTab={setTab}
            questionCount={ordered.length}
            unanswered={unanswered}
          />
          {/* Mobile-only focus toggle — one-question-at-a-time flow. */}
          {tab === 'questions' && ordered.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              icon={Lightning}
              className="sm:hidden"
              data-testid="focus-toggle"
              onClick={() => {
                setFocusIndex(0);
                setFocusMode((f) => !f);
              }}
            >
              {focusMode ? 'List' : 'Focus'}
            </Button>
          ) : null}
        </div>

        {tab === 'questions' ? (
          <div role="tabpanel" id="tabpanel-questions" aria-labelledby="tab-questions">
            {ordered.length === 0 ? (
              <QuestionsEmpty
                connected={connected}
                onCopySetupPrompt={() => void copySetupPrompt()}
              />
            ) : focusMode && focusQ ? (
              // ── Mobile one-question focus view ──
              <section aria-live="polite" className="ask-zen-focus flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <Eyebrow>
                    Question {Math.min(focusIndex + 1, ordered.length)} of {ordered.length}
                  </Eyebrow>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      shape="square"
                      icon={ArrowLeft}
                      aria-label="Previous question"
                      disabled={focusIndex === 0}
                      onClick={() => setFocusIndex((i) => Math.max(0, i - 1))}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      shape="square"
                      icon={ArrowRight}
                      aria-label="Next question"
                      disabled={focusIndex >= ordered.length - 1}
                      onClick={() => setFocusIndex((i) => Math.min(ordered.length - 1, i + 1))}
                    />
                  </div>
                </div>
                {renderCard(focusQ, true)}
                {/* Rapid-answer rail: skip / delegate without scrolling to the card footer. */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => void handleSubmit(focusQ, { kind: 'skip' }, undefined)}
                  >
                    Skip
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => void handleSubmit(focusQ, { kind: 'delegate' }, undefined)}
                  >
                    Let the agent decide
                  </Button>
                </div>
              </section>
            ) : (
              // ── Desktop / mobile list view ──
              <div
                className={['ask-zen-focus flex flex-col gap-4', zen ? 'ask-zen-active' : ''].join(
                  ' ',
                )}
                aria-live="polite"
                aria-relevant="additions"
              >
                {grouped
                  ? // ── Grouped by source repo (≥2 distinct repos) ──
                    repoGroups.map(([repoKey, list]) => (
                      <section
                        key={repoKey || '__room__'}
                        data-testid="repo-group"
                        className="flex flex-col gap-3"
                      >
                        <RepoGroupHeader repo={repoKey} count={list.length} />
                        <div className="flex flex-col gap-4">{renderOrderedList(list, false)}</div>
                      </section>
                    ))
                  : // ── Single flat list (0–1 repos) — unchanged behavior ──
                    renderOrderedList(ordered, true)}
              </div>
            )}

            {/* Archived questions (§6) — collapsed disclosure below the active list. */}
            <div className="mt-4">
              <ArchivedSection
                questions={archivedQuestions}
                open={showArchived}
                onToggle={() => setShowArchived((v) => !v)}
                canRestore={isOwner}
                archivingIds={archivingIds}
                onRestore={(q) => void setArchived(q, false)}
              />
            </div>
          </div>
        ) : null}

        {tab === 'decisions' ? (
          <div role="tabpanel" id="tabpanel-decisions" aria-labelledby="tab-decisions">
            <DecisionsTab store={store} />
          </div>
        ) : null}
        {tab === 'activity' ? (
          <div role="tabpanel" id="tabpanel-activity" aria-labelledby="tab-activity">
            <ActivityTab store={store} />
          </div>
        ) : null}

        {/* Owner-only upgrade — honest about billing readiness. */}
        {isOwner ? (
          <Card data-zen-hide className="mt-2 flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Lock size={18} className="text-[color:var(--ask-accent)]" />
                <div>
                  <Heading level={2} className="text-base">
                    Make this page private
                  </Heading>
                  <Muted className="text-[0.85rem]">Keep it visible only to you — $10/month.</Muted>
                </div>
              </div>
              <Button
                variant="outline"
                icon={Lock}
                loading={checkingOut}
                data-testid="make-private"
                onClick={() => void onCheckout()}
              >
                <span className="min-w-[8ch] text-center">Make private</span>
              </Button>
            </div>
            {checkoutNote === 'coming-soon' ? (
              <Banner
                variant="secondary"
                size="sm"
                title="Private pages — coming soon"
                description="Billing isn't live yet, so this page stays public for now. Nothing was charged."
              />
            ) : checkoutNote === 'error' ? (
              <Banner
                variant="error"
                size="sm"
                title="Couldn't start checkout"
                description="Something went wrong. Please try again shortly."
              />
            ) : null}
          </Card>
        ) : null}
      </main>
    </div>
  );
}

/**
 * RoomTabs — an accessible tablist with ARROW-KEY navigation + roving tabindex
 * (replaces Kumo <Tabs> so we own the keyboard model + the "N unanswered" count).
 * ←/→ move between tabs, Home/End jump to ends; only the active tab is in the tab
 * order (roving), the rest are reachable via arrows per the WAI-ARIA tabs pattern.
 * The questions tab shows a live "N unanswered" count affordance.
 */
function RoomTabs({
  tab,
  onTab,
  questionCount,
  unanswered,
}: {
  tab: TabKey;
  onTab: (t: TabKey) => void;
  questionCount: number;
  unanswered: number;
}) {
  const refs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    questions: null,
    decisions: null,
    activity: null,
  });

  const focusTab = (t: TabKey) => {
    onTab(t);
    // Move focus with the selection so the roving tabindex + arrow model matches.
    window.requestAnimationFrame(() => refs.current[t]?.focus());
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const i = TAB_ORDER.indexOf(tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusTab(TAB_ORDER[(i + 1) % TAB_ORDER.length]!);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusTab(TAB_ORDER[(i - 1 + TAB_ORDER.length) % TAB_ORDER.length]!);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(TAB_ORDER[0]!);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(TAB_ORDER[TAB_ORDER.length - 1]!);
    }
  };

  const label: Record<TabKey, string> = {
    questions: `Questions${questionCount ? ` (${questionCount})` : ''}`,
    decisions: 'Decisions',
    activity: 'Activity',
  };

  return (
    <div
      role="tablist"
      aria-label="Room sections"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="flex items-center gap-1 border-b border-white/10"
    >
      {TAB_ORDER.map((t) => {
        const active = t === tab;
        return (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t}`}
            data-testid={`tab-${t}`}
            aria-selected={active}
            aria-controls={`tabpanel-${t}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onTab(t)}
            className={[
              'relative -mb-px inline-flex min-h-[32px] items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-[color:var(--ask-accent)] text-white'
                : 'border-transparent text-white/60 hover:text-white/85',
            ].join(' ')}
          >
            {label[t]}
            {/* "N unanswered" count affordance, only on the Questions tab. */}
            {t === 'questions' && unanswered > 0 ? (
              <span
                data-testid="unanswered-count"
                aria-label={`${unanswered} unanswered`}
                title={`${unanswered} still need an answer`}
                className="ask-mono inline-flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[color:var(--ask-accent-soft)] px-1.5 text-[0.65rem] font-semibold text-[color:var(--ask-accent)] ring-1 ring-[color:var(--ask-accent-line)]"
              >
                {unanswered}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The connection surface: a prominent setup CTA pre-connection, a quiet live
 *  status line once an agent has checked in (agent · state · branch/task · seen). */
function ConnectionPanel({
  connected,
  connection,
  latestAgent,
  setupPrompt,
  onCopySetupPrompt,
}: {
  connected: boolean;
  connection: string;
  latestAgent: RoomStore['agents'][number] | undefined;
  setupPrompt: string | null;
  onCopySetupPrompt: () => void;
}) {
  if (!connected) {
    return (
      <Card
        as="section"
        glow
        className="ask-aurora ask-enter relative flex flex-col gap-3 overflow-hidden p-6"
      >
        <Eyebrow>
          <span className="inline-flex items-center gap-1.5">
            <PlugsConnected size={14} /> Step 1
          </span>
        </Eyebrow>
        <Heading level={2} className="ask-h2">
          Connect your coding agent
        </Heading>
        <Muted>
          Paste this into Claude Code, Codex, Cursor, Gemini CLI, or OpenCode. The questions it
          would otherwise guess at will appear here — live.
        </Muted>
        <div>
          <Button
            variant="primary"
            icon={ClipboardIcon}
            data-testid="copy-setup-prompt"
            onClick={onCopySetupPrompt}
          >
            Copy setup prompt
          </Button>
        </div>
        {setupPrompt ? (
          <pre className="ask-code ask-scroll mt-1 max-h-56 w-full overflow-auto rounded-xl border border-white/10 bg-black/50 p-3.5 text-white/70">
            {setupPrompt}
          </pre>
        ) : null}
      </Card>
    );
  }

  const chip = latestAgent ? agentStatusChip(latestAgent.status) : undefined;
  const connectionLabel: Record<string, string> = {
    connecting: 'Connecting…',
    open: 'Live',
    reconnecting: 'Reconnecting…',
    closed: 'Offline',
  };
  const isLive = connection === 'open';

  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
      <span
        className={[
          'ask-pulse inline-flex items-center gap-1.5 text-sm font-medium',
          isLive ? 'text-emerald-400' : 'text-amber-300',
        ].join(' ')}
        data-testid="connection-state"
      >
        <span className="relative inline-block h-2 w-2 rounded-full bg-current" />
        {connectionLabel[connection] ?? connection}
      </span>

      {latestAgent ? (
        <>
          <span className="h-4 w-px bg-white/15" aria-hidden="true" />
          <span className="ask-mono text-sm text-white/85">{latestAgent.agent}</span>
          {chip ? (
            <Tooltip content={chip.hint}>
              <span>
                <Badge variant={chip.variant}>{chip.label}</Badge>
              </span>
            </Tooltip>
          ) : null}
          {latestAgent.branch || latestAgent.task ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-white/55">
              <GitBranch size={13} className="shrink-0" />
              <span className="truncate">
                {latestAgent.branch ? <Mono>{latestAgent.branch}</Mono> : null}
                {latestAgent.task ? <span className="ml-1.5">{latestAgent.task}</span> : null}
              </span>
            </span>
          ) : null}
          {latestAgent.lastSeenAt ? (
            <span className="ml-auto text-xs text-white/55">
              checked in {relativeTime(latestAgent.lastSeenAt)}
            </span>
          ) : null}
        </>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        icon={ClipboardIcon}
        className="ml-auto"
        onClick={onCopySetupPrompt}
      >
        Setup prompt
      </Button>
    </section>
  );
}

/**
 * Both get-started prompts on the room page (§22, §28-ext): "set up this project"
 * (repo-scoped) + "add Ask to my skills & CLAUDE.md" (global) — the same pair the
 * dashboard offers, so the owner can wire a new agent/repo or make Ask permanent from
 * the room itself. Open by default until an agent has connected, then a tidy disclosure.
 */
function SetupPromptsSection({
  room,
  connected,
  onToast,
}: {
  room: Room;
  connected: boolean;
  onToast: (t: ToastInput) => void;
}) {
  // Collapsed by default — the ConnectionPanel already leads setup; this is the
  // "make it stick / set up another project" secondary action, one click away.
  const [open, setOpen] = useState(false);
  return (
    <section data-testid="setup-prompts" className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        data-testid="setup-prompts-toggle"
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-1.5 self-start rounded-lg text-sm font-medium text-white/70 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none"
      >
        <CaretRight
          size={14}
          weight="bold"
          className={['shrink-0 transition-transform', open ? 'rotate-90' : ''].join(' ')}
          aria-hidden="true"
        />
        {connected
          ? 'Set up another project — copy a prompt'
          : 'Make Ask stick — copy a setup prompt'}
      </button>
      {open ? <GetStartedPrompts room={room} onToast={onToast} /> : null}
    </section>
  );
}

/**
 * QueueRow — a collapsed one-line row for a "Next & later" question. Shows a
 * blocks/continues dot + the title + a kind badge; clicking (or Enter/Space)
 * expands it to the full QuestionCard. Keeps the queue from becoming a vertical
 * wall while the 5 "Now" cards stay full (§5 "keep the rest in an ordered queue").
 */
function QueueRow({
  question,
  answered,
  onExpand,
}: {
  question: Question;
  answered: boolean;
  onExpand: () => void;
}) {
  const blocks = question.blocksWork;
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={false}
      title={blocks ? 'Blocks work until answered' : 'Work continues without this'}
      aria-label={`${blocks ? 'Blocks work. ' : ''}Expand question: ${question.title}`}
      className="ask-enter ask-card group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#0b0b18]/60 px-4 py-3 text-left hover:border-white/20"
    >
      <span
        className={[
          'inline-block h-2 w-2 shrink-0 rounded-full',
          blocks ? 'bg-amber-400' : 'bg-white/30',
        ].join(' ')}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-[0.92rem] font-medium text-white/90">
        {question.title}
      </span>
      {answered ? (
        <CheckCircle
          size={15}
          weight="fill"
          className="shrink-0 text-emerald-400"
          aria-label="Answered"
        />
      ) : null}
      <span className="ask-mono shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wider text-white/60 ring-1 ring-white/10">
        {KIND_LABEL[question.kind]}
      </span>
      <CaretRight
        size={14}
        className="shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}

/** RepoGroupHeader — a small `owner/repo` header above a repo's question group.
 *  The no-repo bucket renders as "This room". Shown only when ≥2 distinct repos are
 *  present (§28-ext) so a single-project room stays a clean flat list. */
function RepoGroupHeader({ repo, count }: { repo: string; count: number }) {
  const isRoom = !repo;
  return (
    <div
      className="flex items-center gap-2 border-b border-white/10 pb-1.5"
      data-testid="repo-group-header"
    >
      <GitBranch size={14} className="shrink-0 text-[color:var(--ask-accent)]" aria-hidden="true" />
      <span className="ask-mono truncate text-[0.82rem] font-semibold text-white/85">
        {isRoom ? 'This room' : repo}
      </span>
      <span className="ask-mono shrink-0 rounded-full bg-white/5 px-1.5 text-[0.65rem] text-white/55 ring-1 ring-white/10">
        {count}
      </span>
    </div>
  );
}

/** FitWarning — a subtle amber note under an OPEN question the AI flags as a poor fit
 *  for the project or overtaken by events (§6): "May not fit your project" + the concern.
 *  The owner gets a one-tap Archive; non-owners just see the note. Amber (not red) +
 *  AA-contrast text; the action is a real keyboard-operable button. */
function FitWarning({
  concern,
  canArchive,
  archiving,
  onArchive,
}: {
  concern: string;
  canArchive: boolean;
  archiving: boolean;
  onArchive: () => void;
}) {
  return (
    <div
      role="note"
      data-testid="question-fit-warning"
      className="ask-enter ml-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-[0.78rem] leading-snug text-amber-200"
    >
      <span className="inline-flex items-start gap-1.5">
        <Warning size={13} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">May not fit your project.</span>
          {concern ? <span className="text-amber-200/85"> {concern}</span> : null}
        </span>
      </span>
      {canArchive ? (
        <Button
          variant="ghost"
          size="sm"
          icon={Archive}
          loading={archiving}
          disabled={archiving}
          data-testid="question-archive"
          className="ml-auto"
          onClick={onArchive}
        >
          Archive
        </Button>
      ) : null}
    </div>
  );
}

/** ArchivedSection — a collapsed "Archived (N)" disclosure below the active list (§6).
 *  Each row shows the question title + its `archiveReason`; the owner can Restore it
 *  (optimistic; the live WS reconciles). Starts collapsed so it never competes with the
 *  active queue. Keyboard-operable: the summary toggles, each Restore is a real button. */
function ArchivedSection({
  questions,
  open,
  onToggle,
  canRestore,
  archivingIds,
  onRestore,
}: {
  questions: Question[];
  open: boolean;
  onToggle: () => void;
  canRestore: boolean;
  archivingIds: Record<string, boolean>;
  onRestore: (q: Question) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <section data-zen-hide data-testid="archived-section" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="archived-toggle"
        className="group flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm text-white/60 hover:text-white/85"
      >
        <CaretRight
          size={14}
          className={['shrink-0 transition-transform', open ? 'rotate-90' : ''].join(' ')}
          aria-hidden="true"
        />
        <Archive size={14} className="shrink-0" aria-hidden="true" />
        <span className="ask-mono text-[0.72rem] font-semibold uppercase tracking-wider">
          Archived · {questions.length}
        </span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-2">
          {questions.map((q) => (
            <li
              key={q.id}
              data-testid="archived-question"
              className="ask-enter flex items-start gap-3 rounded-xl border border-white/10 bg-[#0b0b18]/50 px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[0.9rem] font-medium text-white/80">{q.title}</span>
                {q.archiveReason ? (
                  <span className="flex items-start gap-1.5 text-[0.78rem] leading-snug text-white/55">
                    <WarningCircle
                      size={12}
                      className="mt-0.5 shrink-0 text-amber-300/80"
                      aria-hidden="true"
                    />
                    {q.archiveReason}
                  </span>
                ) : null}
              </div>
              {canRestore ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ArrowCounterClockwise}
                  loading={Boolean(archivingIds[q.id])}
                  disabled={Boolean(archivingIds[q.id])}
                  data-testid="question-restore"
                  className="shrink-0"
                  onClick={() => onRestore(q)}
                >
                  Restore
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** SharperHint — a subtle, clearly-AI inline note suggesting how to sharpen a
 *  question the enrichment pass flagged as low-value (§6). Deliberately quiet:
 *  a thin accent rail + small muted text, never a loud banner, so it guides
 *  without nagging. aria-labeled as a note; carries no action of its own. */
function SharperHint({ improvement }: { improvement: string }) {
  return (
    <p
      role="note"
      data-testid="question-sharper-hint"
      className="ask-enter ml-3 flex items-start gap-1.5 border-l-2 border-[color:var(--ask-accent-line)] pl-2.5 text-[0.78rem] leading-snug text-white/55"
    >
      <Lightbulb
        size={13}
        weight="fill"
        className="mt-0.5 shrink-0 text-[color:var(--ask-accent)]"
        aria-hidden="true"
      />
      <span>
        <span className="font-medium text-white/70">AI suggestion: </span>
        {improvement}
      </span>
    </p>
  );
}

/** Questions empty state — a launchpad: copy-setup-prompt is the first action.
 *  Egg 8: when connected, the "ask the void" line rotates daily (dev-humor, still
 *  helpful). Egg 6: an HTTP 418 + "42" nod hides in the icon's title attribute. */
function QuestionsEmpty({
  connected,
  onCopySetupPrompt,
}: {
  connected: boolean;
  onCopySetupPrompt: () => void;
}) {
  // Deterministic daily rotation so the line is stable within a session.
  const dayIndex = Math.floor(Date.now() / 86_400_000) % VOID_LINES.length;
  return (
    <Card className="flex flex-col items-center gap-4 p-10 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--ask-accent-soft)] text-[color:var(--ask-accent)]"
        title="HTTP 418 · the answer is 42"
      >
        <QuestionIcon size={30} weight="duotone" />
      </span>
      <Heading level={2} className="ask-h2">
        {connected ? 'No open questions' : 'Waiting for your agent'}
      </Heading>
      <Muted className="max-w-md text-center">
        {connected
          ? VOID_LINES[dayIndex]
          : 'Once your agent is connected, the decisions it would otherwise guess at show up here.'}
      </Muted>
      {!connected ? (
        <Button variant="primary" icon={ClipboardIcon} onClick={onCopySetupPrompt}>
          Copy setup prompt
        </Button>
      ) : null}
    </Card>
  );
}

/** Decisions tab — answered questions + what the agent did with them, incl. the
 *  application receipts (affected paths + source revision + commit) per §5/§10. */
function DecisionsTab({ store }: { store: RoomStore }) {
  const receiptsByQuestion = useMemo(() => {
    const m = new Map<string, ApplicationReceipt[]>();
    for (const r of store.receipts) {
      const arr = m.get(r.questionId) ?? [];
      arr.push(r);
      m.set(r.questionId, arr);
    }
    return m;
  }, [store.receipts]);

  const decided = store.questions
    .map((q) => ({
      q,
      a: [...store.answers]
        .filter((a) => a.questionId === q.id)
        .sort((x, y) => y.revision - x.revision)[0],
      receipts: (receiptsByQuestion.get(q.id) ?? []).sort((x, y) =>
        y.createdAt.localeCompare(x.createdAt),
      ),
    }))
    .filter((x): x is { q: Question; a: AnswerRevision; receipts: ApplicationReceipt[] } =>
      Boolean(x.a),
    );

  if (decided.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <ChatsCircle size={34} className="text-[color:var(--ask-accent)]" />
        <Heading level={2} className="ask-h2">
          No decisions yet
        </Heading>
        <Muted className="max-w-md text-center">
          Answers you submit — and what your agent applies, verifies, or couldn't apply — are
          summarized here with the files it touched.
        </Muted>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {decided.map(({ q, a, receipts }) => {
        const chip = answerStatusChip(a.status);
        const latestReceipt = receipts[0];
        return (
          <Card key={q.id} className="ask-enter flex flex-col gap-2.5 p-4" interactive>
            <div className="flex items-start justify-between gap-3">
              <Heading level={3} className="min-w-0 text-base">
                {q.title}
              </Heading>
              <Tooltip content={chip.hint}>
                <span data-testid="status-chip" className="shrink-0">
                  <Badge variant={chip.variant}>{chip.label}</Badge>
                </span>
              </Tooltip>
            </div>
            <Muted className="text-[0.88rem]">{a.text ?? answerSummary(a.value)}</Muted>

            {latestReceipt ? (
              <div className="mt-1 flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
                  <Receipt size={14} className="text-[color:var(--ask-accent)]" />
                  <span className="font-medium text-white/75">
                    Agent {receiptVerb(latestReceipt.state)}
                  </span>
                  {latestReceipt.commitRef ? (
                    <>
                      <span>·</span>
                      <span>
                        rev <Mono>{latestReceipt.commitRef}</Mono>
                      </span>
                    </>
                  ) : null}
                  <span className="ml-auto">{relativeTime(latestReceipt.createdAt)}</span>
                </div>
                {latestReceipt.affectedPaths.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {latestReceipt.affectedPaths.slice(0, 6).map((p) => (
                      <Mono key={p}>{p}</Mono>
                    ))}
                    {latestReceipt.affectedPaths.length > 6 ? (
                      <span className="text-xs text-white/55">
                        +{latestReceipt.affectedPaths.length - 6} more
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {latestReceipt.validation ? (
                  <p className="text-xs text-white/55">
                    <span className="font-medium text-white/70">Validation: </span>
                    {latestReceipt.validation}
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

/** Activity tab — a live, readable feed of questions, answers, receipts + check-ins. */
function ActivityTab({ store }: { store: RoomStore }) {
  const items = useMemo(() => {
    const rows: { ts: string; text: string; kind: 'question' | 'answer' | 'receipt' | 'agent' }[] =
      [
        ...store.questions.map((q) => ({
          ts: q.createdAt,
          kind: 'question' as const,
          text: `New question — "${q.title}"`,
        })),
        ...store.answers.map((a) => ({
          ts: a.createdAt,
          kind: 'answer' as const,
          text: `Answer ${answerStatusChip(a.status).label.toLowerCase()}`,
        })),
        ...store.receipts.map((r) => ({
          ts: r.createdAt,
          kind: 'receipt' as const,
          text: `Agent ${receiptVerb(r.state)}${r.commitRef ? ` (${r.commitRef})` : ''}${
            r.affectedPaths.length ? ` — ${r.affectedPaths.slice(0, 3).join(', ')}` : ''
          }`,
        })),
        ...store.agents.map((ag) => ({
          ts: ag.lastSeenAt ?? '',
          kind: 'agent' as const,
          text: `${ag.agent} ${ag.status}${ag.task ? ` · ${ag.task}` : ''}`,
        })),
      ];
    return rows.filter((x) => x.ts).sort((a, b) => b.ts.localeCompare(a.ts));
  }, [store]);

  if (items.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <ChatsCircle size={34} className="text-[color:var(--ask-accent)]" />
        <Heading level={2} className="ask-h2">
          Nothing here yet
        </Heading>
        <Muted className="max-w-md text-center">
          Agent check-ins, your answers, and applied changes stream in here as they happen.
        </Muted>
      </Card>
    );
  }

  const dot: Record<string, string> = {
    question: 'bg-[color:var(--ask-accent)]',
    answer: 'bg-emerald-400',
    receipt: 'bg-violet-400',
    agent: 'bg-sky-400',
  };

  return (
    <ol className="relative flex flex-col gap-2 border-l border-white/10 pl-4" aria-live="polite">
      {items.map((it, i) => (
        <li key={i} className="ask-enter relative flex items-baseline gap-3 py-1">
          <span
            className={['absolute -left-[21px] top-2.5 h-2 w-2 rounded-full', dot[it.kind]].join(
              ' ',
            )}
          />
          <time className="ask-mono shrink-0 text-xs text-white/55" title={it.ts}>
            {clockTime(it.ts)}
          </time>
          <span className="text-sm text-white/80">{it.text}</span>
          <span className="ml-auto shrink-0 text-xs text-white/55">{relativeTime(it.ts)}</span>
        </li>
      ))}
    </ol>
  );
}

/** 404 slug → offer to claim it, on-brand. */
function ClaimView({ slug, onToast }: { slug: string; onToast: (t: ToastInput) => void }) {
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const claim = async () => {
    setClaiming(true);
    setError(undefined);
    try {
      const res = await createRoom(slug);
      window.history.replaceState({}, '', `/${res.room.slug}`);
      onToast({
        title: 'Page claimed',
        description: `ask/${res.room.slug} is yours.`,
        variant: 'success',
      });
      window.location.reload();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.code : (e as Error).message);
      setClaiming(false);
    }
  };

  return (
    <div className="ask-shell flex min-h-dvh items-center justify-center p-6">
      <Card
        className="ask-aurora relative flex w-full max-w-md flex-col items-center gap-4 overflow-hidden p-8 text-center"
        glow
      >
        <Eyebrow>Available</Eyebrow>
        <Heading level={1} className="ask-h1">
          This page is free
        </Heading>
        <Muted className="text-center">
          <Mono>ask/{slug}</Mono> isn't taken. Claim it to start a room here.
        </Muted>
        {error ? (
          <Banner
            variant="error"
            size="sm"
            title="Couldn't claim this name"
            description="Try again, or pick a different one."
          />
        ) : null}
        <Button
          variant="primary"
          size="lg"
          loading={claiming}
          data-testid="claim-button"
          onClick={() => void claim()}
        >
          <span className="min-w-[10ch] text-center">
            {claiming ? 'Claiming…' : 'Claim this page'}
          </span>
        </Button>
      </Card>
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
  return state === 'applied'
    ? 'applied this answer'
    : state === 'considered'
      ? 'considered this answer'
      : 'received this answer';
}
