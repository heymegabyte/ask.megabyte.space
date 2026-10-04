/**
 * AskLogo — the Ask brand mark.
 *
 * The mark is a generated (Cloudflare Workers AI / flux image model) gradient
 * rounded-diamond speech bubble with a knocked-out question mark, processed to a
 * TRANSPARENT PNG (`/logo-mark.png` via scripts/process-logo.mjs) so its "?" +
 * background show the page behind it on the dark surface. `<AskMark>` is the icon
 * alone; `<AskLogo>` locks it up with the "ask" wordmark in the brand display face
 * (Space Grotesk, high weight) to the right of the icon.
 */
interface MarkProps {
  className?: string;
  title?: string;
}

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
  markClassName?: string;
  textClassName?: string;
}

/**
 * Icon + "ask" wordmark lockup — the brand home affordance. The wordmark uses the
 * brand display face at high weight, to the right of the icon, per logo-contrast.
 */
export function AskLogo({ className, markClassName, textClassName }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <AskMark
        className={
          markClassName ?? 'h-11 w-11 shrink-0 [filter:drop-shadow(0_0_8px_rgba(0,229,255,0.4))]'
        }
      />
      <span
        className={
          textClassName ??
          'font-bold leading-none tracking-tight text-white [font-family:var(--font-heading)] text-[clamp(1.3rem,4.5vw,1.6rem)]'
        }
      >
        ask
      </span>
    </span>
  );
}
