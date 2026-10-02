/**
 * recentPages — a browser-local list of rooms this device has opened.
 *
 * Deliberately NOT server state: it's a convenience index for the person at this
 * browser (the setup prompt + ownership cookie already live client-side, §4/§11).
 * Stored in localStorage, newest-first, capped, and resilient to quota/parse errors.
 */
const KEY = 'ask.recentPages.v1';
const MAX = 8;

export interface RecentPage {
  slug: string;
  /** Epoch ms of the last visit — drives newest-first ordering + "x ago". */
  at: number;
}

function read(): RecentPage[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is RecentPage => typeof p?.slug === 'string' && typeof p?.at === 'number')
      .slice(0, MAX);
  } catch {
    return [];
  }
}

function write(list: RecentPage[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* private mode / quota — recents are best-effort, never block the UI */
  }
}

/** Record a visit to `slug` (moves it to the front, de-duped). Returns the new list. */
export function recordRecentPage(slug: string): RecentPage[] {
  if (!slug) return read();
  const now = Date.now();
  const next = [{ slug, at: now }, ...read().filter((p) => p.slug !== slug)].slice(0, MAX);
  write(next);
  return next;
}

/** The recent pages for this browser, newest-first. */
export function getRecentPages(): RecentPage[] {
  return read();
}

/** Remove one slug (e.g. when it 404s / is renamed away). Returns the new list. */
export function forgetRecentPage(slug: string): RecentPage[] {
  const next = read().filter((p) => p.slug !== slug);
  write(next);
  return next;
}
