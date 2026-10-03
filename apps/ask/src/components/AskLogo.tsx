/**
 * AskLogo — the Ask brand mark.
 *
 * One clever mark that unifies both prior motifs: a speech bubble (the room where
 * agents ask) rendered as a cyan→violet gradient squircle with a tail, and a bold
 * question mark PUNCHED OUT of it whose dot is the brand ◆ diamond (brand continuity
 * + "the question your agent should ask"). The cut is a real mask, so the "?" shows
 * whatever is behind the mark — bg-independent, crisp from favicon to hero, themeable.
 *
 * `<AskMark>` is the icon alone; `<AskLogo>` locks it up with the "ask" wordmark in
 * the brand display face (Space Grotesk, high weight) to the right of the icon.
 */
import { useId } from 'react';

interface MarkProps {
  className?: string;
  title?: string;
}

/** The icon mark alone (square, 1:1). Size it via className (e.g. `h-12 w-12`). */
export function AskMark({ className, title = 'Ask' }: MarkProps) {
  // Unique per instance so multiple marks on one page never collide on gradient/mask ids.
  const uid = useId().replace(/:/g, '');
  const grad = `askG-${uid}`;
  const cut = `askCut-${uid}`;
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={grad} x1="8" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00E5FF" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
        <mask id={cut}>
          {/* show the whole mark… */}
          <rect x="0" y="0" width="48" height="48" fill="white" />
          {/* …then punch out the question's hook + stem… */}
          <path
            d="M16.6 18.2C16.6 11.8 20.2 8.6 24.2 8.6C28.6 8.6 31.8 11.7 31.8 15.5C31.8 20 27.8 21.5 25.4 24C24.1 25.4 23.7 26.4 23.7 28.6"
            fill="none"
            stroke="black"
            strokeWidth="4.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* …and its dot, as the brand ◆ diamond. */}
          <path d="M24 30.6L27 33.4L24 36.2L21 33.4Z" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${cut})`}>
        {/* speech-bubble body */}
        <rect x="4" y="4" width="40" height="40" rx="12" fill={`url(#${grad})`} />
        {/* speech-bubble tail (bottom-left) */}
        <path d="M14 42L10 47.5L22 43Z" fill={`url(#${grad})`} />
      </g>
    </svg>
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
