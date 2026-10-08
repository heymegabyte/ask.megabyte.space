/**
 * AskLogo — the Ask brand mark.
 *
 * An Ideogram-V3 (DESIGN) generated gradient speech bubble with a knocked-out
 * question mark, luminance-keyed to a TRANSPARENT PNG so its "?" + field show the
 * dark surface through it (scripts/gen-logo.mjs → scripts/process-logo.mjs). Two
 * shipped assets:
 *   • /logo-mark.png   — the icon alone (square) → favicon/PWA + compact/mobile.
 *   • /logo-lockup.png — icon + baked "ask" wordmark (Ideogram-rendered) → navbar sm+.
 * <AskMark> is the icon; <AskLogo> shows the icon below `sm` and the full lockup above.
 */
interface MarkProps {
  className?: string;
  title?: string;
}

const GLOW = '[filter:drop-shadow(0_0_8px_rgba(0,229,255,0.4))]';

/** The icon mark alone (square). Size it via className (e.g. `h-12 w-12`). */
export function AskMark({ className, title = 'Ask' }: MarkProps) {
  return (
    <img
      src="/logo-mark.png"
      alt={title}
      width={512}
      height={512}
      decoding="async"
      className={`object-contain ${className ?? ''}`}
    />
  );
}

interface LogoProps {
  className?: string;
  /** Icon size for the mobile / compact rendering (e.g. `h-10 w-10`). */
  markClassName?: string;
  /** Lockup height for the sm+ rendering (e.g. `h-9`). */
  lockupClassName?: string;
  /** Force icon-only — never the wordmark lockup. */
  compact?: boolean;
}

/**
 * Brand home affordance. Icon-only below `sm` (dense bars) and the full baked
 * icon+"ask" lockup from `sm` up — the wordmark is rendered into the logo itself
 * (Ideogram), per the brand's text-in-logo direction.
 */
export function AskLogo({ className, markClassName, lockupClassName, compact }: LogoProps) {
  if (compact) {
    return (
      <span className={`inline-flex items-center ${className ?? ''}`}>
        <AskMark className={`${markClassName ?? 'h-10 w-10'} shrink-0 ${GLOW}`} />
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center ${className ?? ''}`}>
      <AskMark className={`${markClassName ?? 'h-10 w-10'} shrink-0 sm:hidden ${GLOW}`} />
      <img
        src="/logo-lockup.png"
        alt="Ask"
        decoding="async"
        className={`hidden w-auto object-contain sm:block ${lockupClassName ?? 'h-9'} ${GLOW}`}
      />
    </span>
  );
}
