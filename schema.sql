-- SongLink schema (Neon / Postgres)
-- Run once via `psql $DATABASE_URL -f schema.sql` or Neon's SQL editor.

-- Cache of MusicBrainz lookups so we never hit their rate limit twice for
-- the same song and gameplay verification is effectively instant.
CREATE TABLE IF NOT EXISTS song_cache (
  cache_key        TEXT PRIMARY KEY,
  found            BOOLEAN NOT NULL,
  canonical_title  TEXT,
  canonical_artist TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A game (one chain). Pass-and-play stores everything here; online
-- multiplayer (v2) will add a players table keyed to game_id.
CREATE TABLE IF NOT EXISTS games (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode          TEXT NOT NULL DEFAULT 'pass_and_play',
  status        TEXT NOT NULL DEFAULT 'active',  -- active | finished
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every accepted move in the chain. forbidden_stem on row N is the stem
-- that linked INTO song N, i.e. the word the NEXT player may not reuse.
CREATE TABLE IF NOT EXISTS moves (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq            INT  NOT NULL,
  title          TEXT NOT NULL,
  artist         TEXT NOT NULL,
  player_label   TEXT,
  link_word      TEXT,            -- raw word the player chose
  link_stem      TEXT,            -- stemmed form (forbidden for next move)
  override       BOOLEAN NOT NULL DEFAULT false, -- group-accepted despite no MB hit
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, seq)
);

CREATE INDEX IF NOT EXISTS moves_game_seq ON moves (game_id, seq);
