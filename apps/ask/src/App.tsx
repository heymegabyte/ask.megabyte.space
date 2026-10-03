/**
 * App — resolves the surface from the URL path.
 *
 * Path `/`                 → the personal dashboard (<Dashboard/>): the viewer's own
 *                            rooms as cards + one "New page" action. No auto-create.
 * Path `/<slug>`           → a room by its word-slug. 200 → render; 404 → claim screen;
 *                            private + not owner → an honest "private page" notice.
 * Path `/<owner>/<repo>`   → resolve the git repo to its room. 200 → replaceState to
 *                            `/{slug}` + render the room; 404 → a compact "No Ask project
 *                            yet for {owner}/{repo}" screen offering the two get-started
 *                            prompts, prefilled with that repo.
 *
 * Reserved / api paths are never treated as a repo path — they fall through to the
 * room resolver (which 404s them honestly) so we never shadow a system route.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Loader, useKumoToastManager } from '@cloudflare/kumo';
import { GitBranch } from '@phosphor-icons/react';
import { RESERVED_SLUGS } from '@ask/contracts';
import { resolveRepo } from './api';
import { Room } from './Room';
import { Dashboard } from './Dashboard';
import { Eggs } from './eggs';
import { GetStartedPrompts } from './components/GetStartedPrompts';
import { Card, Eyebrow, Heading, Mono, Muted } from './components/ui';

type ToastInput = {
  title: string;
  description?: string;
  variant?: 'success' | 'error' | 'info' | 'warning';
};

/** The path split into non-empty, decoded segments. `[]` for the root. */
function pathSegments(): string[] {
  return window.location.pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
}

/**
 * A 2-segment path is a repo path ONLY when neither segment is a reserved/system
 * slug (so `/api/health`, `/.well-known/x`, etc. never read as `owner/repo`).
 */
function repoPath(segs: string[]): { owner: string; repo: string } | undefined {
  if (segs.length !== 2) return undefined;
  const [owner, repo] = segs;
  if (!owner || !repo) return undefined;
  if (RESERVED_SLUGS.includes(owner.toLowerCase())) return undefined;
  return { owner, repo };
}

/** A compact 404 for a repo path with no Ask project yet — offers the get-started prompts. */
function NoProjectView({
  owner,
  repo,
  onToast,
}: {
  owner: string;
  repo: string;
  onToast: (t: ToastInput) => void;
}) {
  const repoSlug = `${owner}/${repo}`.toLowerCase();
  return (
    <div className="ask-shell flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <Card
          className="ask-aurora ask-enter relative flex flex-col items-center gap-3 overflow-hidden p-8 text-center"
          glow
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--ask-accent-soft)] text-[color:var(--ask-accent)]">
            <GitBranch size={24} weight="duotone" aria-hidden="true" />
          </span>
          <Eyebrow>No Ask project yet</Eyebrow>
          <Heading level={1} className="ask-h2">
            Nothing here for <Mono>{repoSlug}</Mono>
          </Heading>
          <Muted className="max-w-lg text-center">
            This repo doesn't have an Ask room yet. Set one up in your coding agent below — then its
            questions will appear here, live.
          </Muted>
          <Button variant="outline" size="sm" onClick={() => window.location.assign('/')}>
            Back to your pages
          </Button>
        </Card>

        <div className="flex flex-col gap-3">
          <Eyebrow>Get started with {repoSlug}</Eyebrow>
          {/* Prefill the prompts with this repo's slug so the agent sets THIS project up. */}
          <GetStartedPrompts room={{ slug: repoSlug }} onToast={onToast} />
        </div>
      </div>
    </div>
  );
}

/** Resolves a `/<owner>/<repo>` path: 200 → swap to the room slug; 404 → the no-project screen. */
function RepoResolver({
  owner,
  repo,
  onToast,
}: {
  owner: string;
  repo: string;
  onToast: (t: ToastInput) => void;
}) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'room'; slug: string } | { status: 'none' }
  >({
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await resolveRepo(owner, repo);
        if (cancelled) return;
        if (res) {
          // Adopt the canonical word-slug URL, then render the room by that slug.
          window.history.replaceState({}, '', `/${res.slug}`);
          setState({ status: 'room', slug: res.slug });
        } else {
          setState({ status: 'none' });
        }
      } catch {
        if (!cancelled) setState({ status: 'none' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  if (state.status === 'loading') {
    return (
      <div className="ask-shell flex min-h-dvh flex-col items-center justify-center gap-4">
        <Loader size="lg" aria-label="Resolving project" />
        <Muted>
          Looking up <Mono>{`${owner}/${repo}`}</Mono>…
        </Muted>
      </div>
    );
  }
  if (state.status === 'room') return <Room identifier={state.slug} onToast={onToast} />;
  return <NoProjectView owner={owner} repo={repo} onToast={onToast} />;
}

export function App() {
  const toasts = useKumoToastManager();
  const [segs, setSegs] = useState<string[]>(pathSegments());

  // Keep in sync with browser back/forward.
  useEffect(() => {
    const onPop = () => setSegs(pathSegments());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const toast = useCallback(
    (t: ToastInput) =>
      toasts.add({ title: t.title, description: t.description, variant: t.variant }),
    [toasts],
  );

  // SPA navigate to a slug (used by the dashboard) without a full reload.
  const openSlug = useCallback((slug: string) => {
    window.history.pushState({}, '', `/${slug}`);
    setSegs([slug]);
  }, []);

  const firstSeg = segs[0];
  const repo = repoPath(segs);

  return (
    <>
      {/* Tasteful, reduced-motion-safe easter eggs + the keyboard-shortcut legend.
          Mounted once at the root so eggs work on every surface. */}
      <Eggs slug={firstSeg || undefined} />
      {segs.length === 0 ? (
        <Dashboard onOpen={openSlug} onToast={toast} />
      ) : repo ? (
        <RepoResolver owner={repo.owner} repo={repo.repo} onToast={toast} />
      ) : (
        // Single-segment (room slug) — or any 3+ segment path, which the room resolver 404s.
        <Room identifier={firstSeg!} onToast={toast} />
      )}
    </>
  );
}

export { Loader };
