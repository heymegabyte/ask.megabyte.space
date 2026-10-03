/**
 * RoomHeader — a compact, calm, on-brand top bar for a room.
 *
 * Left:  the Ask wordmark + the slug (owner can inline-edit → PATCH settings, with
 *        optimistic apply and error revert) + a public/private badge.
 * Right: copy-link (toast), and an overflow menu (New page · Copy setup prompt ·
 *        Open link · a browser-local "recent pages" list).
 *
 * The overflow menu is a SELF-CONTAINED controlled menu (not Kumo's DropdownMenu,
 * whose `Trigger render={<Button/>}` didn't forward the trigger's click/ref, so it
 * never opened). It's a plain `<button aria-haspopup="menu">` toggling an absolutely-
 * positioned panel, with click-outside + Escape to close, roving focus into the first
 * item on open, and focus restored to the trigger on close. Every item is a real
 * `<a>`/`<button>`, keyboard-operable with the app-wide focus-visible ring.
 *
 * The slug stays on one line and reads as the room's identity, not a form field,
 * until the owner edits it. Everything is dark-consistent and AA-contrast.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Badge, Button, Input, Tooltip } from '@cloudflare/kumo';
import {
  Check,
  ClockCounterClockwise,
  DotsThreeVertical,
  GlobeSimple,
  LinkSimple,
  Lock,
  PencilSimple,
  Plus,
  ClipboardText as ClipboardIcon,
  X,
} from '@phosphor-icons/react';
import type { Room } from '@ask/contracts';
import { updateSettings, ApiError } from '../api';
import { getRecentPages } from '../recentPages';
import { AskLogo } from './AskLogo';
import { relativeTime } from './ui';

interface Props {
  room: Room;
  isOwner: boolean;
  roomUrl: string;
  onRoomChange: (room: Room) => void;
  onCopySetupPrompt: () => void;
  onCopyLink: () => void;
  onNewPage: () => void;
  onToast: (t: {
    title: string;
    description?: string;
    variant?: 'success' | 'error' | 'info';
  }) => void;
}

/** Shared item classes so every menu row (button or link) looks + focuses identically. */
const ITEM_CLASS =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-white/85 transition-colors hover:bg-white/10 focus-visible:bg-white/10';

export function RoomHeader({
  room,
  isOwner,
  roomUrl,
  onRoomChange,
  onCopySetupPrompt,
  onCopyLink,
  onNewPage,
  onToast,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draftSlug, setDraftSlug] = useState(room.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  // ── overflow menu (self-contained, controlled) ──────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Recent pages are read fresh each render (localStorage, this device).
  const recents = getRecentPages().filter((p) => p.slug !== room.slug);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Click-outside + Escape close. Bound only while the menu is open.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuWrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, closeMenu]);

  // On open, move focus to the first item so the menu is keyboard-operable.
  useEffect(() => {
    if (!menuOpen) return;
    const first = panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [menuOpen]);

  // Run an item's action then close (restoring focus to the trigger).
  const runItem = useCallback(
    (fn: () => void) => {
      fn();
      closeMenu();
    },
    [closeMenu],
  );

  const startEdit = () => {
    setDraftSlug(room.slug);
    setError(undefined);
    setEditing(true);
  };

  const save = async () => {
    const next = draftSlug.trim().toLowerCase();
    if (next === room.slug) {
      setEditing(false);
      return;
    }
    // Optimistic: adopt the new slug immediately, revert on failure.
    const previous = room;
    setSaving(true);
    setError(undefined);
    onRoomChange({ ...room, slug: next });
    try {
      const res = await updateSettings(room.id, next);
      onRoomChange(res.room);
      window.history.replaceState({}, '', `/${res.room.slug}`);
      setEditing(false);
      onToast({
        title: 'Renamed',
        description: `This page is now /${res.room.slug}`,
        variant: 'success',
      });
    } catch (e: unknown) {
      onRoomChange(previous); // revert the optimistic change
      const msg =
        e instanceof ApiError && e.code === 'slug_taken'
          ? 'That name is taken — try another.'
          : e instanceof ApiError && e.code === 'invalid_slug'
            ? 'Use lowercase words joined by hyphens.'
            : 'Could not rename. Try again.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-[#060610]/85 px-4 py-3 backdrop-blur-md sm:px-6">
      {/* Brand logo — icon always, high-weight wordmark on sm+ (room bar is dense). */}
      <a href="/" aria-label="Ask — home" className="flex shrink-0 items-center">
        <AskLogo
          markClassName="h-10 w-10 shrink-0 [filter:drop-shadow(0_0_7px_rgba(0,229,255,0.4))]"
          textClassName="hidden text-[1.4rem] font-bold leading-none tracking-tight text-white [font-family:var(--font-heading)] sm:inline"
        />
      </a>
      <span className="hidden h-5 w-px shrink-0 bg-white/15 sm:block" aria-hidden="true" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {editing ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="ask-mono shrink-0 text-white/55">ask/</span>
            <Input
              ref={inputRef}
              size="sm"
              aria-label="Page name"
              data-testid="slug-input"
              value={draftSlug}
              variant={error ? 'error' : 'default'}
              error={error}
              onChange={(e) => setDraftSlug(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <Button
              size="sm"
              variant="primary"
              shape="square"
              icon={Check}
              aria-label="Save page name"
              loading={saving}
              onClick={() => void save()}
            />
            <Button
              size="sm"
              variant="ghost"
              shape="square"
              icon={X}
              aria-label="Cancel rename"
              disabled={saving}
              onClick={() => setEditing(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={isOwner ? startEdit : undefined}
            className="group flex min-w-0 items-center gap-1.5 rounded-md bg-transparent px-1 text-left"
            aria-label={isOwner ? `Rename page (currently ${room.slug})` : `Page ${room.slug}`}
            disabled={!isOwner}
          >
            <span className="ask-mono truncate text-[clamp(1rem,3.5vw,1.3rem)] font-semibold text-white">
              <span className="text-white/55">ask/</span>
              {room.slug}
            </span>
            {isOwner ? (
              <PencilSimple
                size={15}
                className="shrink-0 text-white/50 opacity-0 transition-opacity group-hover:opacity-100"
              />
            ) : null}
          </button>
        )}

        <Tooltip
          content={
            room.visibility === 'private'
              ? 'Only you can view this page.'
              : 'Anyone with the link can view this page.'
          }
        >
          <span>
            <Badge
              variant={room.visibility === 'private' ? 'purple' : 'info'}
              icon={room.visibility === 'private' ? Lock : GlobeSimple}
            >
              {room.visibility === 'private' ? 'Private' : 'Public'}
            </Badge>
          </span>
        </Tooltip>
      </div>

      <Tooltip
        content="Copy a link to this page"
        render={
          <Button
            variant="outline"
            size="sm"
            icon={LinkSimple}
            aria-label="Copy link"
            data-testid="copy-link"
            onClick={onCopyLink}
          />
        }
      >
        <span className="hidden sm:inline">Copy link</span>
      </Tooltip>

      {/* Self-contained overflow menu — opens reliably on click at every width. */}
      <div ref={menuWrapRef} className="relative shrink-0">
        <Button
          ref={triggerRef}
          variant="ghost"
          shape="square"
          icon={DotsThreeVertical}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          data-testid="room-menu-trigger"
          onClick={() => setMenuOpen((o) => !o)}
        />
        {menuOpen ? (
          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            aria-label="Room actions"
            data-testid="room-menu"
            className="ask-enter absolute right-0 top-[calc(100%+6px)] z-40 flex max-h-[min(70vh,26rem)] w-64 flex-col overflow-auto rounded-xl border border-white/10 bg-[#0b0b18]/95 p-1.5 shadow-2xl backdrop-blur-md"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="menu-new-page"
              className={ITEM_CLASS}
              onClick={() => runItem(onNewPage)}
            >
              <Plus size={16} className="shrink-0 text-white/70" aria-hidden="true" />
              New page
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="menu-copy-setup-prompt"
              className={ITEM_CLASS}
              onClick={() => runItem(onCopySetupPrompt)}
            >
              <ClipboardIcon size={16} className="shrink-0 text-white/70" aria-hidden="true" />
              Copy setup prompt
            </button>
            <a
              role="menuitem"
              href={roomUrl}
              data-testid="menu-open-room"
              className={ITEM_CLASS}
              onClick={() => closeMenu(false)}
            >
              <GlobeSimple size={16} className="shrink-0 text-white/70" aria-hidden="true" />
              Open room link
            </a>

            {recents.length ? (
              <>
                <div className="my-1 h-px bg-white/10" role="separator" />
                <p className="ask-mono flex items-center gap-1.5 px-3 py-1 text-[0.68rem] uppercase tracking-wider text-white/55">
                  <ClockCounterClockwise size={13} aria-hidden="true" /> Recent pages
                </p>
                {recents.map((p) => (
                  <a
                    key={p.slug}
                    role="menuitem"
                    href={`/${p.slug}`}
                    data-testid="menu-recent-page"
                    className={ITEM_CLASS}
                    onClick={() => closeMenu(false)}
                  >
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="ask-mono truncate">ask/{p.slug}</span>
                      <span className="shrink-0 text-xs text-white/60">
                        {relativeTime(new Date(p.at).toISOString())}
                      </span>
                    </span>
                  </a>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
