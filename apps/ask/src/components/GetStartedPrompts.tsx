/**
 * GetStartedPrompts — the two copyable "get started with Ask" cards.
 *
 * Shown on the dashboard zero-state and the per-repo 404 screen. Each card has a
 * title, the prompt in a scrollable code block, a Copy button (with toast), and a
 * one-line WHY so the developer can choose between them:
 *   (A) "Set up this project"            — try it on one repo, nothing global changes.
 *   (B) "Add Ask to my skills & CLAUDE.md" — make it permanent across all projects.
 *
 * Dark-consistent, AA-contrast, keyboard-operable (every control is a real button
 * with the app-wide focus-visible ring).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@cloudflare/kumo';
import {
  Check,
  ClipboardText as ClipboardIcon,
  FolderSimple,
  GlobeHemisphereWest,
} from '@phosphor-icons/react';
import type { MeRoom, ResolveRepoResponse, Room } from '@ask/contracts';
import { globalSetupPrompt, projectSetupPrompt } from '../setupPrompt';
import { Card, Eyebrow, Heading } from './ui';

type ToastInput = {
  title: string;
  description?: string;
  variant?: 'success' | 'error' | 'info' | 'warning';
};
type RoomLike = Room | MeRoom | ResolveRepoResponse | { slug: string };

function PromptCard({
  eyebrow,
  title,
  why,
  prompt,
  icon,
  testid,
  onToast,
}: {
  eyebrow: string;
  title: string;
  why: string;
  prompt: string;
  icon: typeof FolderSimple;
  testid: string;
  onToast: (t: ToastInput) => void;
}) {
  const Icon = icon;
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
      onToast({
        title: 'Prompt copied',
        description: 'Paste it into your coding agent.',
        variant: 'success',
      });
    } catch {
      onToast({
        title: 'Copy failed',
        description: 'Select the text below and copy it manually.',
        variant: 'error',
      });
    }
  }, [prompt, onToast]);

  return (
    <Card as="section" className="flex flex-col gap-3 p-5" interactive data-testid={testid}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--ask-accent-soft)] text-[color:var(--ask-accent)]">
            <Icon size={18} weight="duotone" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <Heading level={3} className="mt-0.5 text-base">
              {title}
            </Heading>
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={copied ? Check : ClipboardIcon}
          data-testid={`${testid}-copy`}
          aria-live="polite"
          onClick={() => void copy()}
        >
          <span className="min-w-[4.5ch] text-center">{copied ? 'Copied' : 'Copy'}</span>
        </Button>
      </div>

      {/* WHY — the one line that lets the developer choose this option. */}
      <p
        className="flex gap-1.5 text-[0.85rem] leading-relaxed text-white/60"
        data-testid={`${testid}-why`}
      >
        <span className="font-semibold text-white/75">Why:</span>
        {why}
      </p>

      <pre className="ask-code ask-scroll max-h-44 w-full overflow-auto rounded-xl border border-white/10 bg-black/50 p-3.5 text-[0.8rem] text-white/70">
        {prompt}
      </pre>
    </Card>
  );
}

export function GetStartedPrompts({
  room,
  onToast,
  className = '',
}: {
  room: RoomLike;
  onToast: (t: ToastInput) => void;
  className?: string;
}) {
  return (
    <div className={['grid gap-4 sm:grid-cols-2', className].join(' ')}>
      <PromptCard
        eyebrow="Option A"
        title="Set up this project"
        why="Self-contained — try Ask on one repo, nothing global changes."
        prompt={projectSetupPrompt(room)}
        icon={FolderSimple}
        testid="prompt-project"
        onToast={onToast}
      />
      <PromptCard
        eyebrow="Option B"
        title="Add Ask to my skills & CLAUDE.md"
        why="Make it permanent — every project you work in auto-uses Ask."
        prompt={globalSetupPrompt(room)}
        icon={GlobeHemisphereWest}
        testid="prompt-global"
        onToast={onToast}
      />
    </div>
  );
}
