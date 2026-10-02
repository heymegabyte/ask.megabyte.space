/**
 * App — resolves the room from the URL and renders the right surface.
 *
 * Path `/`       → create a fresh room, adopt its slug via replaceState, then
 *                  render it. On failure: one prominent "Free" button (retries) +
 *                  an inline error.
 * Path `/<slug>` → load the snapshot by slug. 200 → render (room.id drives WS +
 *                  writes). 404 → offer to claim the name. Private + not owner → an
 *                  honest "private page" notice (handled in <Room/>).
 */
import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Loader, useKumoToastManager } from '@cloudflare/kumo';
import { Sparkle } from '@phosphor-icons/react';
import { createRoom, ApiError } from './api';
import { Room } from './Room';
import { Card, Eyebrow, Heading, Muted } from './components/ui';

type ToastInput = { title: string; description?: string; variant?: 'success' | 'error' | 'info' | 'warning' };

/** First path segment, decoded; '' for the root. */
function currentSlug(): string {
  return decodeURIComponent(window.location.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
}

/** Root path: create a room, then swap the URL to its slug and render it. */
function CreateFlow() {
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const create = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await createRoom();
      const next = new URL(res.room.slug, window.location.origin).pathname;
      window.history.replaceState({}, '', next);
      setSlug(res.room.slug);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.code : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void create();
  }, [create]);

  if (slug) return <Room identifier={slug} />;

  return (
    <div className="ask-shell flex min-h-dvh items-center justify-center p-6">
      <Card
        className="ask-aurora relative flex w-full max-w-lg flex-col items-center gap-5 overflow-hidden p-8 text-center sm:p-10"
        glow
      >
        <Eyebrow>Ask · for coding agents</Eyebrow>
        <Heading level={1} className="ask-h1">
          The questions your agents
          <br className="hidden sm:block" /> should have asked
        </Heading>
        <Muted className="max-w-md text-center text-[0.98rem]">
          A calm room where your coding agents raise the decisions they'd otherwise guess at — and you answer them,
          live.
        </Muted>

        {error ? (
          <Banner
            variant="error"
            className="w-full text-left"
            title="Couldn't open a page"
            description="Give it another try — nothing was lost."
          />
        ) : null}

        <Button
          variant="primary"
          size="lg"
          icon={Sparkle}
          loading={busy}
          data-testid="free-button"
          onClick={() => void create()}
        >
          <span className="min-w-[7ch] text-center">{busy ? 'Opening…' : 'Start free'}</span>
        </Button>

        <Muted className="text-xs text-white/45">
          {busy ? 'Claiming a fresh page for you…' : 'No sign-up. A new page opens instantly.'}
        </Muted>
      </Card>
    </div>
  );
}

export function App() {
  const toasts = useKumoToastManager();
  const [slug, setSlug] = useState<string>(currentSlug());

  // Keep in sync with browser back/forward.
  useEffect(() => {
    const onPop = () => setSlug(currentSlug());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const toast = useCallback(
    (t: ToastInput) => toasts.add({ title: t.title, description: t.description, variant: t.variant }),
    [toasts],
  );

  if (!slug) return <CreateFlow />;
  return <Room identifier={slug} onToast={toast} />;
}

export { Loader };
