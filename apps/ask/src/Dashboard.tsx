/**
 * Dashboard — the apex surface at `/`.
 *
 * Instead of auto-creating a room, `/` now shows the viewer's OWN rooms (scoped to
 * this browser's principal via the session cookie) as cards: the `ask/{slug}` name,
 * the AI `understanding.summary` under an "AI summary" label, question/open counts,
 * the git `repos` that have published to it, and relative last-activity. Clicking a
 * card opens `/{slug}`. One prominent "New page" primary action sits up top.
 *
 * Zero rooms → a welcoming empty state showing the two get-started prompts (step 4).
 * To make those prompts reference a real, claimable room URL, we open one fresh room
 * on first load of an empty dashboard (nothing is shown until it's ready), so the
 * copyable prompt points the agent at a room that already exists.
 *
 * Gorgeous, dark, on-brand, and keyboard-navigable: the grid is a plain list of
 * links/cards, every control carries the app-wide focus-visible ring.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Loader } from '@cloudflare/kumo';
import {
  ArrowClockwise,
  ArrowRight,
  ChatCircleDots,
  GitBranch,
  Plus,
  Sparkle,
} from '@phosphor-icons/react';
import type { MeRoom } from '@ask/contracts';
import { createRoom, fetchMeRooms, ApiError } from './api';
import { AskLogo } from './components/AskLogo';
import { GetStartedPrompts } from './components/GetStartedPrompts';
import { Card, Eyebrow, Heading, Muted, relativeTime, slugAccentHue } from './components/ui';

type ToastInput = {
  title: string;
  description?: string;
  variant?: 'success' | 'error' | 'info' | 'warning';
};

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rooms: MeRoom[] };

interface Props {
  /** Navigate to a slug (replaceState + re-resolve) — supplied by <App/>. */
  onOpen: (slug: string) => void;
  onToast?: (t: ToastInput) => void;
}

const noop = () => {};

export function Dashboard({ onOpen, onToast = noop }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [creating, setCreating] = useState(false);
  // A fresh room opened only to anchor the zero-state's get-started prompts.
  const [seedRoom, setSeedRoom] = useState<MeRoom | { slug: string } | undefined>();

  const refresh = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetchMeRooms();
      setState({ status: 'ready', rooms: res.rooms });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Empty dashboard → open one room so the get-started prompts reference a real URL.
  useEffect(() => {
    if (state.status !== 'ready' || state.rooms.length > 0 || seedRoom) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await createRoom();
        if (!cancelled) setSeedRoom({ slug: res.room.slug });
      } catch {
        /* non-fatal — the prompts fall back to a generic room URL */
        if (!cancelled) setSeedRoom({ slug: 'your-page' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, seedRoom]);

  const newPage = useCallback(async () => {
    setCreating(true);
    try {
      const res = await createRoom();
      onOpen(res.room.slug);
    } catch (e: unknown) {
      onToast({
        title: "Couldn't open a new page",
        description: e instanceof ApiError ? undefined : 'Try again in a moment.',
        variant: 'error',
      });
      setCreating(false);
    }
  }, [onOpen, onToast]);

  if (state.status === 'loading') {
    return (
      <div className="ask-shell flex min-h-dvh flex-col items-center justify-center gap-4">
        <Loader size="lg" aria-label="Loading your pages" />
        <Muted>Loading your pages…</Muted>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="ask-shell flex min-h-dvh items-center justify-center p-6">
        <Card className="flex max-w-md flex-col items-center gap-4 p-8 text-center" glow>
          <Heading level={1} className="ask-h2">
            Couldn't load your pages
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

  const { rooms } = state;

  return (
    <div className="ask-shell min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-[#060610]/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <span className="flex shrink-0 items-center">
          <AskLogo markClassName="h-12 w-12" lockupClassName="h-11" />
        </span>
        <span className="hidden h-5 w-px shrink-0 bg-white/15 sm:block" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm text-white/55">Your pages</span>
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          loading={creating}
          data-testid="dashboard-new-page"
          onClick={() => void newPage()}
        >
          <span className="min-w-[7ch] text-center">New page</span>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
        {rooms.length === 0 ? (
          // ── Welcoming zero-state: the two get-started prompts. ──
          <section className="flex flex-col gap-6">
            <Card
              className="ask-aurora ask-enter relative flex flex-col items-center gap-4 overflow-hidden p-8 text-center sm:p-10"
              glow
            >
              <Eyebrow>Ask · for coding agents</Eyebrow>
              <Heading level={1} className="ask-h1">
                The questions your agents
                <br className="hidden sm:block" /> should have asked
              </Heading>
              <Muted className="max-w-xl text-center text-[0.98rem]">
                Ask gives your coding agents a room to raise the decisions they'd otherwise guess at
                — and you answer them, live. Pick how you want to start: try it on one project, or
                make it permanent everywhere.
              </Muted>
              <Button
                variant="primary"
                size="lg"
                icon={Sparkle}
                loading={creating}
                data-testid="dashboard-empty-new-page"
                onClick={() => void newPage()}
              >
                <span className="min-w-[9ch] text-center">
                  {creating ? 'Opening…' : 'New page'}
                </span>
              </Button>
            </Card>

            <div className="flex flex-col gap-3">
              <Eyebrow>Get started in your agent</Eyebrow>
              {seedRoom ? (
                <GetStartedPrompts room={seedRoom} onToast={onToast} />
              ) : (
                <div className="flex items-center justify-center p-6">
                  <Loader aria-label="Preparing your prompts" />
                </div>
              )}
            </div>
          </section>
        ) : (
          // ── Room cards. ──
          <section className="flex flex-col gap-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <Eyebrow>Your pages</Eyebrow>
                <Heading level={1} className="ask-h2 mt-0.5">
                  {rooms.length} {rooms.length === 1 ? 'page' : 'pages'}
                </Heading>
              </div>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {rooms.map((r) => (
                <RoomCardItem key={r.room.id} room={r} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

/** One room card in the dashboard grid — a link to `/{slug}` with the AI summary + counts. */
function RoomCardItem({ room: r, onOpen }: { room: MeRoom; onOpen: (slug: string) => void }) {
  const slug = r.room.slug;
  const accentHue = slugAccentHue(slug);
  return (
    <Card
      as="li"
      interactive
      className="ask-enter flex flex-col"
      style={{ ['--ask-accent-h' as string]: String(accentHue) }}
    >
      <a
        href={`/${slug}`}
        data-testid="dashboard-room-card"
        aria-label={`Open ask/${slug}`}
        className="group flex min-h-full flex-col gap-3 rounded-2xl border-l-2 border-[color:var(--ask-accent-line)] p-5"
        onClick={(e) => {
          // Let modified clicks (new tab) behave normally; otherwise SPA-navigate.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onOpen(slug);
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="ask-mono truncate text-[1.05rem] font-semibold text-white">
            <span className="text-white/55">ask/</span>
            {slug}
          </span>
          <ArrowRight
            size={16}
            className="shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>

        {r.understanding?.summary ? (
          <div className="flex flex-col gap-1">
            <span className="ask-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--ask-accent)]">
              AI summary
            </span>
            <p className="line-clamp-3 text-[0.88rem] leading-relaxed text-white/70">
              {r.understanding.summary}
            </p>
          </div>
        ) : (
          <p className="text-[0.88rem] italic leading-relaxed text-white/45">No AI summary yet.</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-white/60">
            <ChatCircleDots
              size={14}
              className="text-[color:var(--ask-accent)]"
              aria-hidden="true"
            />
            {r.questionCount} {r.questionCount === 1 ? 'question' : 'questions'}
          </span>
          {r.openCount > 0 ? (
            <span
              className="ask-mono inline-flex min-h-[20px] items-center rounded-full bg-[color:var(--ask-accent-soft)] px-2 text-[0.65rem] font-semibold text-[color:var(--ask-accent)] ring-1 ring-[color:var(--ask-accent-line)]"
              title={`${r.openCount} still need an answer`}
            >
              {r.openCount} open
            </span>
          ) : null}
          {r.lastActivityAt ? (
            <span className="ml-auto text-xs text-white/50">{relativeTime(r.lastActivityAt)}</span>
          ) : null}
        </div>

        {r.repos.length ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {r.repos.slice(0, 4).map((repo) => (
              <span
                key={repo}
                className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[0.7rem] text-white/70 ring-1 ring-white/10"
              >
                <GitBranch size={11} className="shrink-0 text-white/50" aria-hidden="true" />
                <span className="ask-mono truncate">{repo}</span>
              </span>
            ))}
            {r.repos.length > 4 ? (
              <span className="text-[0.7rem] text-white/50">+{r.repos.length - 4}</span>
            ) : null}
          </div>
        ) : null}
      </a>
    </Card>
  );
}
