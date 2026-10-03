/**
 * ui — tiny shared presentational primitives for Ask.
 *
 * Everything here is dark-consistent by construction (brand black + Kumo dark
 * tokens, never a white panel) and AA-contrast on dark. Keeping these in one
 * place means every surface (hero, room, tabs, cards, states) stays on-brand and
 * targeted follow-up edits touch one file, not twenty.
 */
import type { ReactNode } from 'react';

/** Deterministic slug → accent hue (OKLCH hue degrees). Seeded so a room's accent
 *  is stable, but clamped to a cyan→violet arc that always reads well on black. */
export function slugAccentHue(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  // Map into 185..300 (cyan → blue → violet) — never into low-contrast yellows/greens.
  return 185 + (h % 116);
}

/** Dark card surface — the one card look used everywhere. `glow` adds an accent hairline. */
export function Card({
  children,
  className = '',
  as: As = 'div',
  glow = false,
  interactive = false,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
  glow?: boolean;
  interactive?: boolean;
} & Record<string, unknown>) {
  return (
    <As
      className={[
        'rounded-2xl border bg-[#0b0b18]/80 backdrop-blur-sm',
        'shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]',
        glow ? 'border-[color:var(--ask-accent-line)]' : 'border-white/10',
        interactive ? 'ask-card' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </As>
  );
}

/** A small uppercase eyebrow label in the accent color (AA on dark). */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={[
        'ask-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em]',
        'text-[color:var(--ask-accent)]',
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

/** A high-contrast heading (white-ish, never Kumo's muted default) — fixes the
 *  low-contrast heading defect. Renders a real heading element for the outline. */
export function Heading({
  children,
  level = 3,
  className = '',
}: {
  children: ReactNode;
  level?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  const Tag = `h${level}` as const;
  return (
    <Tag className={['font-[var(--font-heading)] font-semibold text-white', className].join(' ')}>
      {children}
    </Tag>
  );
}

/** Secondary copy with guaranteed-AA contrast on dark (lighter than Kumo subtle). */
export function Muted({
  children,
  className = '',
  as: As = 'p',
}: {
  children: ReactNode;
  className?: string;
  as?: 'p' | 'span' | 'div';
}) {
  return (
    <As className={['text-[0.9rem] leading-relaxed text-white/70', className].join(' ')}>
      {children}
    </As>
  );
}

/** Inline mono chip for slug / id / code fragments. */
export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={[
        'ask-mono rounded-md bg-white/5 px-1.5 py-0.5 text-[0.85em] text-white/85 ring-1 ring-white/10',
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

/** A compact labeled line used in question cards: bold label + value, AA contrast. */
export function MetaLine({
  label,
  children,
  icon,
}: {
  label: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <p className="flex gap-1.5 text-[0.9rem] leading-relaxed text-white/75">
      {icon ? <span className="mt-0.5 shrink-0 text-[color:var(--ask-accent)]">{icon}</span> : null}
      <span>
        <span className="font-semibold text-white/90">{label} </span>
        {children}
      </span>
    </p>
  );
}

/** Relative "x ago" from an ISO string; empty string for missing/invalid dates. */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Absolute clock time (HH:MM) for event rows; empty for invalid. */
export function clockTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
