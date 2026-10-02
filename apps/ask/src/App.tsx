/**
 * App — resolves the room from the URL and renders the right surface.
 *
 * Path `/`            → create a fresh room, adopt its slug via replaceState,
 *                       then render it. On failure: one prominent "Free" button
 *                       (retries) + an inline error Banner.
 * Path `/<slug>`      → load the snapshot by slug. 200 → render (room.id drives
 *                       WS + writes). 404 → offer to claim the name. Private +
 *                       not owner → an honest "private page" notice.
 */
import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Loader, Text, useKumoToastManager } from '@cloudflare/kumo';
import { Sparkle } from '@phosphor-icons/react';
import { createRoom, ApiError } from './api';
import { Room } from './Room';

type ToastInput = { title: string; description?: string; variant?: 'success' | 'error' | 'info' | 'warning' };

/** First path segment, decoded; '' for the root. */
function currentSlug(): string {
  return decodeURIComponent(window.location.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>;
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
    <Centered>
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <Text as="h1" variant="heading" size="lg">
          Ask
        </Text>
        <Text variant="secondary">
          Answer the questions your coding agents should have been asking all along.
        </Text>
        {error ? (
          <Banner
            className="w-full text-left"
            variant="error"
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
          {busy ? 'Opening…' : 'Free'}
        </Button>
        {busy ? (
          <Text variant="secondary" size="sm">
            Claiming a fresh page for you…
          </Text>
        ) : null}
      </div>
    </Centered>
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
