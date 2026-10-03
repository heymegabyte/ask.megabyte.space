-- Per-project (git repo) addressing (§28-ext).
-- Maps a normalized `owner/name` git repo to the room it first enrolled into,
-- so `/{owner}/{repo}` resolves to that project's room. First-wins (INSERT OR IGNORE):
-- a repo never steals another room's slot once claimed.
CREATE TABLE IF NOT EXISTS repo_rooms (
  repo_slug  TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repo_rooms_room ON repo_rooms (room_id);
