/**
 * eggs — tasteful, non-noisy delight for Ask.
 *
 * One <Eggs/> component mounts every easter egg + the keyboard-shortcut legend.
 * Everything here is reduced-motion-safe (the starfield degrades to a static
 * cyan glow), dark + brand-cyan by construction, axe-clean, and NEVER spammy
 * (no confetti, no repeated toasts). The eggs are discovered, not pushed.
 *
 * Eggs owned here:
 *  1. Konami code (↑↑↓↓←→←→ B A) → a brief cyan starfield shimmer; auto-dismiss.
 *  2. Console ASCII banner (cyan) + "we're hiring builders" + the room URL.
 *  3. "?" key → a focus-trapped, aria-modal keyboard-shortcut legend.
 *  5. Typing "zen" (not in an input) → toggles calm mode (hides chrome, centers
 *     the active question). Typing it again toggles off. Dispatched as an event +
 *     a class on <html> so Room/App can react.
 *
 * (Eggs 4/6/7/8 live where their surface is: first-answer celebration, 418/42
 * nods, slug flourish, and rotating empty-state lines are in Room/RoomHeader.)
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const ZEN_CLASS = 'ask-zen';
const ZEN_EVENT = 'ask:zen';

/** Is the user currently typing into a field? Then swallow single-key eggs. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    el.getAttribute('role') === 'textbox'
  );
}

/** True when the user asked for reduced motion (SSR-safe). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * useKeySequence — fires `onMatch` when the given key sequence is typed in order.
 * Case-insensitive for letters; resets on any out-of-order key. Ignores keys
 * pressed while typing in an input (so "zen" in a text field never triggers).
 */
function useKeySequence(sequence: string[], onMatch: () => void): void {
  const posRef = useRef(0);
  const onMatchRef = useRef(onMatch);
  onMatchRef.current = onMatch;

  useEffect(() => {
    const want = sequence.map((k) => k.toLowerCase());
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) {
        posRef.current = 0;
        return;
      }
      const key = e.key.toLowerCase();
      const expected = want[posRef.current];
      if (key === expected) {
        posRef.current += 1;
        if (posRef.current === want.length) {
          posRef.current = 0;
          onMatchRef.current();
        }
      } else {
        // Allow a mismatch to still be the start of a fresh sequence.
        posRef.current = key === want[0] ? 1 : 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sequence]);
}

/** The shortcuts the legend documents — real, wired behaviors. */
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '?', label: 'Show / hide this shortcuts panel' },
  { keys: '← →', label: 'Switch tabs (Questions · Decisions · Activity)' },
  { keys: 'zen', label: 'Toggle calm mode — hide chrome, center the question' },
  { keys: '↑↑↓↓←→←→ B A', label: 'Stir the void' },
  { keys: 'Esc', label: 'Close this panel or cancel an edit' },
];

/** Konami starfield overlay — a brief cyan shimmer, auto-dismissing. Reduced
 *  motion → a single static radial glow (no travel, no twinkle). */
function Starfield({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    // Auto-dismiss either way; static glow lingers a touch longer to be seen.
    const t = window.setTimeout(onDone, reduced ? 2600 : 4500);
    return () => window.clearTimeout(t);
  }, [onDone, reduced]);

  useEffect(() => {
    if (reduced) return; // static glow is pure CSS; skip the animation loop
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
    };
    resize();

    const COUNT = Math.min(160, Math.floor(window.innerWidth / 9));
    const stars = Array.from({ length: COUNT }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      z: Math.random() * 0.8 + 0.2,
      tw: Math.random() * Math.PI * 2,
    }));
    const cx = () => canvas.width / 2;
    const cy = () => canvas.height / 2;

    const tick = () => {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        // Drift gently outward from center — a calm "the void stirs".
        s.x += (s.x - cx()) * 0.0016 * s.z;
        s.y += (s.y - cy()) * 0.0016 * s.z;
        s.tw += 0.05;
        if (s.x < 0 || s.x > canvas.width || s.y < 0 || s.y > canvas.height) {
          s.x = cx() + (Math.random() - 0.5) * 40 * dpr;
          s.y = cy() + (Math.random() - 0.5) * 40 * dpr;
          s.z = Math.random() * 0.8 + 0.2;
        }
        const a = 0.35 + 0.45 * Math.abs(Math.sin(s.tw));
        ctx.fillStyle = `rgba(0, 229, 255, ${a * s.z})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.z * 1.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    return () => {
      running = false;
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [reduced]);

  return (
    <div
      className="ask-starfield"
      role="presentation"
      aria-hidden="true"
      onClick={onDone}
      data-testid="konami-starfield"
    >
      {reduced ? <div className="ask-starfield-glow" /> : <canvas ref={canvasRef} />}
      <span className="ask-starfield-label">the void stirs…</span>
    </div>
  );
}

/** Focus-trapped, aria-modal keyboard-shortcut legend. Esc or backdrop closes;
 *  focus is restored to whatever had it before open. */
function ShortcutLegend({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    closeRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Minimal focus trap across the dialog's focusable elements.
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="ask-legend-backdrop"
      onClick={onClose}
      data-testid="shortcut-legend-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-legend-title"
        className="ask-legend ask-enter"
        data-testid="shortcut-legend"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ask-legend-head">
          <h2 id="ask-legend-title" className="ask-legend-title">
            <span aria-hidden="true">◆</span> Keyboard shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="ask-legend-close"
            aria-label="Close shortcuts panel"
            onClick={onClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <dl className="ask-legend-list">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="ask-legend-row">
              <dt>
                <kbd className="ask-kbd">{s.keys}</kbd>
              </dt>
              <dd>{s.label}</dd>
            </div>
          ))}
        </dl>
        <p className="ask-legend-foot">Press Esc to close · the void is listening.</p>
      </div>
    </div>
  );
}

interface Props {
  /** The room slug (for the console banner's URL). */
  slug?: string;
}

/**
 * Eggs — mount once near the app root. Wires every keyboard egg, the starfield,
 * the legend, and zen-mode (as an <html> class + a broadcast event). No visible
 * chrome until an egg is triggered.
 */
export function Eggs({ slug }: Props) {
  const [starfield, setStarfield] = useState(false);
  const [legend, setLegend] = useState(false);

  // Egg 1 — Konami code.
  useKeySequence(
    ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'],
    () => setStarfield(true),
  );

  // Egg 5 — "zen".
  const toggleZen = useCallback(() => {
    const root = document.documentElement;
    const next = !root.classList.contains(ZEN_CLASS);
    root.classList.toggle(ZEN_CLASS, next);
    window.dispatchEvent(new CustomEvent(ZEN_EVENT, { detail: { active: next } }));
  }, []);
  useKeySequence(['z', 'e', 'n'], toggleZen);

  // Egg 3 — "?" opens the legend (and toggles it closed). Esc also handled by it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === '?') {
        e.preventDefault();
        setLegend((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Egg 2 — console banner, once per load.
  useEffect(() => {
    const url = slug ? `${window.location.origin}/${slug}` : window.location.origin;
    const cyan = 'color:#00E5FF;font-family:ui-monospace,monospace';
    const dim = 'color:#7a7a8a;font-family:ui-monospace,monospace';
    // eslint-disable-next-line no-console
    console.log(
      `%c
   ◆ ask
   the questions your coding agents should have asked

%c   we're hiring builders → say hi, we read every message
   this room: ${url}
   psst — press ?  ·  type zen  ·  ↑↑↓↓←→←→ B A`,
      cyan,
      dim,
    );
  }, [slug]);

  return (
    <>
      {starfield ? <Starfield onDone={() => setStarfield(false)} /> : null}
      {legend ? <ShortcutLegend onClose={() => setLegend(false)} /> : null}
    </>
  );
}

/**
 * useZenMode — subscribe to zen-mode state (driven by the "zen" egg). Returns
 * the current boolean; re-renders the caller on toggle. SSR-safe.
 */
export function useZenMode(): boolean {
  const [zen, setZen] = useState(
    typeof document !== 'undefined' && document.documentElement.classList.contains(ZEN_CLASS),
  );
  useEffect(() => {
    const onZen = (e: Event) => {
      const detail = (e as CustomEvent<{ active: boolean }>).detail;
      setZen(Boolean(detail?.active));
    };
    window.addEventListener(ZEN_EVENT, onZen);
    return () => window.removeEventListener(ZEN_EVENT, onZen);
  }, []);
  return zen;
}
