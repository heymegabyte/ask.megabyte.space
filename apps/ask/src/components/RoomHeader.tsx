/**
 * RoomHeader — a compact, calm top bar for a room.
 *
 * Shows the slug (owner can inline-edit → PATCH settings), a copy-link control,
 * a public/private Badge, and an overflow menu. The slug stays on one line and
 * reads as the room's identity, not a form field, until the owner edits it.
 */
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, DropdownMenu, Input, InlineCopyText } from '@cloudflare/kumo';
import { Check, DotsThree, GlobeSimple, Lock, PencilSimple, X } from '@phosphor-icons/react';
import type { Room } from '@ask/contracts';
import { updateSettings, ApiError } from '../api';

interface Props {
  room: Room;
  isOwner: boolean;
  roomUrl: string;
  onRoomChange: (room: Room) => void;
  onCopySetupPrompt: () => void;
  onToast: (t: { title: string; description?: string; variant?: 'success' | 'error' | 'info' }) => void;
}

export function RoomHeader({ room, isOwner, roomUrl, onRoomChange, onCopySetupPrompt, onToast }: Props) {
  const [editing, setEditing] = useState(false);
  const [draftSlug, setDraftSlug] = useState(room.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

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
    setSaving(true);
    setError(undefined);
    try {
      const res = await updateSettings(room.id, next);
      onRoomChange(res.room);
      setEditing(false);
      onToast({ title: 'Renamed', description: `This page is now /${res.room.slug}`, variant: 'success' });
    } catch (e: unknown) {
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
    <header className="flex items-center gap-3 border-b border-kumo-hairline px-4 py-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {editing ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-kumo-subtle">ask/</span>
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
            <span className="truncate text-[clamp(1rem,3.5vw,1.25rem)] font-semibold text-kumo-default">
              <span className="text-kumo-subtle">ask/</span>
              {room.slug}
            </span>
            {isOwner ? (
              <PencilSimple
                size={15}
                className="shrink-0 text-kumo-subtle opacity-0 transition-opacity group-hover:opacity-100"
              />
            ) : null}
          </button>
        )}

        <Badge
          variant={room.visibility === 'private' ? 'neutral' : 'info'}
          icon={room.visibility === 'private' ? Lock : GlobeSimple}
        >
          {room.visibility === 'private' ? 'Private' : 'Public'}
        </Badge>
      </div>

      <InlineCopyText value={roomUrl} variant="body" size="sm" onCopy={() => onToast({ title: 'Link copied' })}>
        Copy link
      </InlineCopyText>

      <DropdownMenu>
        <DropdownMenu.Trigger
          render={<Button variant="ghost" shape="square" icon={DotsThree} aria-label="More actions" />}
        />
        <DropdownMenu.Content>
          <DropdownMenu.Item onClick={onCopySetupPrompt}>Copy setup prompt</DropdownMenu.Item>
          <DropdownMenu.LinkItem href={roomUrl}>Open room link</DropdownMenu.LinkItem>
        </DropdownMenu.Content>
      </DropdownMenu>
    </header>
  );
}
