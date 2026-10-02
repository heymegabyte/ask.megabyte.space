/**
 * RoomHeader — a compact, calm, on-brand top bar for a room.
 *
 * Left:  the Ask wordmark + the slug (owner can inline-edit → PATCH settings, with
 *        optimistic apply and error revert) + a public/private badge.
 * Right: copy-link (toast), and an overflow menu (New page · Copy setup prompt ·
 *        Open link · a browser-local "recent pages" list).
 *
 * The slug stays on one line and reads as the room's identity, not a form field,
 * until the owner edits it. Everything is dark-consistent and AA-contrast.
 */
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, DropdownMenu, Input, Tooltip } from '@cloudflare/kumo';
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
import { relativeTime } from './ui';

interface Props {
  room: Room;
  isOwner: boolean;
  roomUrl: string;
  onRoomChange: (room: Room) => void;
  onCopySetupPrompt: () => void;
  onCopyLink: () => void;
  onNewPage: () => void;
  onToast: (t: { title: string; description?: string; variant?: 'success' | 'error' | 'info' }) => void;
}

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

  // Recent pages are read fresh when the menu mounts (localStorage, this device).
  const recents = getRecentPages().filter((p) => p.slug !== room.slug);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

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
      onToast({ title: 'Renamed', description: `This page is now /${res.room.slug}`, variant: 'success' });
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
      {/* Wordmark */}
      <a
        href="/"
        aria-label="Ask — home"
        className="ask-mono hidden shrink-0 items-center gap-1 text-sm font-semibold text-white sm:flex"
      >
        <span className="text-[color:var(--ask-accent)]">◆</span> ask
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

      <DropdownMenu>
        <DropdownMenu.Trigger
          render={<Button variant="ghost" shape="square" icon={DotsThreeVertical} aria-label="More actions" />}
        />
        <DropdownMenu.Content>
          <DropdownMenu.Item onClick={onNewPage} icon={Plus} data-testid="menu-new-page">
            New page
          </DropdownMenu.Item>
          <DropdownMenu.Item onClick={onCopySetupPrompt} icon={ClipboardIcon}>
            Copy setup prompt
          </DropdownMenu.Item>
          <DropdownMenu.LinkItem href={roomUrl} icon={GlobeSimple}>
            Open room link
          </DropdownMenu.LinkItem>
          {recents.length ? (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Label>
                <span className="inline-flex items-center gap-1.5 text-white/55">
                  <ClockCounterClockwise size={13} /> Recent pages
                </span>
              </DropdownMenu.Label>
              {recents.map((p) => (
                <DropdownMenu.LinkItem key={p.slug} href={`/${p.slug}`} data-testid="menu-recent-page">
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="ask-mono truncate">ask/{p.slug}</span>
                    <span className="shrink-0 text-xs text-white/60">{relativeTime(new Date(p.at).toISOString())}</span>
                  </span>
                </DropdownMenu.LinkItem>
              ))}
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu>
    </header>
  );
}
