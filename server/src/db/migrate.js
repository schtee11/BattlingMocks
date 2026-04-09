import { pathToFileURL } from 'url';
import { pool } from './pool.js';

const SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  position VARCHAR(10) NOT NULL,
  school VARCHAR(120),
  headshot_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name VARCHAR(60) NOT NULL UNIQUE,
  email VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id VARCHAR(32) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE TABLE IF NOT EXISTS mocks (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  is_locked BOOLEAN DEFAULT FALSE,
  total_score INTEGER DEFAULT 0,
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS mock_picks (
  id SERIAL PRIMARY KEY,
  mock_id INTEGER NOT NULL REFERENCES mocks(id) ON DELETE CASCADE,
  pick_number INTEGER NOT NULL CHECK (pick_number BETWEEN 1 AND 32),
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  UNIQUE (mock_id, pick_number),
  UNIQUE (mock_id, player_id)
);

CREATE TABLE IF NOT EXISTS actual_picks (
  pick_number INTEGER PRIMARY KEY CHECK (pick_number BETWEEN 1 AND 32),
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  team VARCHAR(5),
  entered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS draft_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  draft_year INTEGER DEFAULT 2026,
  is_locked BOOLEAN DEFAULT FALSE,
  scoring_run_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS draft_order (
  pick_number INTEGER PRIMARY KEY CHECK (pick_number BETWEEN 1 AND 32),
  team VARCHAR(5) NOT NULL,
  team_name VARCHAR(80) NOT NULL,
  team_needs TEXT[] DEFAULT ARRAY[]::TEXT[],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE draft_order ADD COLUMN IF NOT EXISTS team_needs TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Phase 3: loosen pick_number checks + add round column so the schema can
-- hold all 7 rounds. Existing R1 data stays intact (default round = 1).
ALTER TABLE draft_order ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE actual_picks ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mock_picks ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1;

ALTER TABLE draft_order DROP CONSTRAINT IF EXISTS draft_order_pick_number_check;
ALTER TABLE draft_order ADD CONSTRAINT draft_order_pick_number_check CHECK (pick_number BETWEEN 1 AND 262);

ALTER TABLE actual_picks DROP CONSTRAINT IF EXISTS actual_picks_pick_number_check;
ALTER TABLE actual_picks ADD CONSTRAINT actual_picks_pick_number_check CHECK (pick_number BETWEEN 1 AND 262);

ALTER TABLE mock_picks DROP CONSTRAINT IF EXISTS mock_picks_pick_number_check;
ALTER TABLE mock_picks ADD CONSTRAINT mock_picks_pick_number_check CHECK (pick_number BETWEEN 1 AND 262);

CREATE INDEX IF NOT EXISTS idx_draft_order_round ON draft_order(round);
CREATE INDEX IF NOT EXISTS idx_actual_picks_round ON actual_picks(round);
CREATE INDEX IF NOT EXISTS idx_mock_picks_round ON mock_picks(round);

INSERT INTO draft_settings (id, draft_year, is_locked)
VALUES (1, 2026, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_mocks_user_id ON mocks(user_id);
CREATE INDEX IF NOT EXISTS idx_mocks_total_score ON mocks(total_score DESC, submitted_at ASC);
CREATE INDEX IF NOT EXISTS idx_mock_picks_mock_id ON mock_picks(mock_id);
CREATE INDEX IF NOT EXISTS idx_actual_picks_player ON actual_picks(player_id);
CREATE INDEX IF NOT EXISTS idx_users_display_name_lower ON users (LOWER(display_name));
`;

export async function migrate() {
  await pool.query(SQL);
  console.log('[migrate] schema ready');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
