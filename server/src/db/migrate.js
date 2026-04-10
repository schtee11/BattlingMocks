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
-- Phase 4: team ownership is snapshotted onto each mock_pick so saved team
-- mocks can show who owned each pick AT THE TIME OF SAVE (including any
-- trades the user made during that simulation).
ALTER TABLE mock_picks ADD COLUMN IF NOT EXISTS team VARCHAR(5);

ALTER TABLE draft_order DROP CONSTRAINT IF EXISTS draft_order_pick_number_check;
ALTER TABLE draft_order ADD CONSTRAINT draft_order_pick_number_check CHECK (pick_number BETWEEN 1 AND 262);

ALTER TABLE actual_picks DROP CONSTRAINT IF EXISTS actual_picks_pick_number_check;
ALTER TABLE actual_picks ADD CONSTRAINT actual_picks_pick_number_check CHECK (pick_number BETWEEN 1 AND 262);

ALTER TABLE mock_picks DROP CONSTRAINT IF EXISTS mock_picks_pick_number_check;
ALTER TABLE mock_picks ADD CONSTRAINT mock_picks_pick_number_check CHECK (pick_number BETWEEN 1 AND 262);

CREATE INDEX IF NOT EXISTS idx_draft_order_round ON draft_order(round);
CREATE INDEX IF NOT EXISTS idx_actual_picks_round ON actual_picks(round);
CREATE INDEX IF NOT EXISTS idx_mock_picks_round ON mock_picks(round);

-- Phase 4: team-specific mock drafts. Existing R1 scored mocks default to
-- mock_type='round1'; the new bot-driven team mock uses mock_type='team'.
-- The R1 scored showdown is limited to 1 per user (enforced by partial
-- unique index below), but team mocks are unlimited.
ALTER TABLE mocks ADD COLUMN IF NOT EXISTS mock_type VARCHAR(20) NOT NULL DEFAULT 'round1';
ALTER TABLE mocks ADD COLUMN IF NOT EXISTS team_abbr VARCHAR(5);
ALTER TABLE mocks ADD COLUMN IF NOT EXISTS title VARCHAR(80);
-- Phase 4b: persist the trades made during a team mock simulation so the
-- saved-mock detail view can render them. Stored as a JSON array:
-- [{ "partnerTeam": "NYJ", "gave": [25,100], "got": [20] }, ...]
ALTER TABLE mocks ADD COLUMN IF NOT EXISTS trades JSONB DEFAULT '[]'::jsonb;
ALTER TABLE mocks DROP CONSTRAINT IF EXISTS mocks_user_id_key;
-- Earlier iterations of Phase 4 added a full (user_id, mock_type) unique
-- constraint; drop it so users can save as many team mocks as they want.
ALTER TABLE mocks DROP CONSTRAINT IF EXISTS mocks_user_id_mock_type_key;
-- Partial unique: only the round1 showdown is capped at one per user.
CREATE UNIQUE INDEX IF NOT EXISTS mocks_round1_user_unique
  ON mocks(user_id) WHERE mock_type = 'round1';
CREATE INDEX IF NOT EXISTS idx_mocks_user_id_mock_type ON mocks(user_id, mock_type);

INSERT INTO draft_settings (id, draft_year, is_locked)
VALUES (1, 2026, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_mocks_user_id ON mocks(user_id);
CREATE INDEX IF NOT EXISTS idx_mocks_total_score ON mocks(total_score DESC, submitted_at ASC);
CREATE INDEX IF NOT EXISTS idx_mock_picks_mock_id ON mock_picks(mock_id);
CREATE INDEX IF NOT EXISTS idx_mock_picks_player_id ON mock_picks(player_id);
CREATE INDEX IF NOT EXISTS idx_actual_picks_player ON actual_picks(player_id);
CREATE INDEX IF NOT EXISTS idx_users_display_name_lower ON users (LOWER(display_name));
`;

// Split the migration SQL into individual statements and run them one at a
// time so a single failing DDL (due to legacy constraints, weird data, etc.)
// doesn't nuke the entire schema deploy. Failures are logged loudly but the
// rest of the migration continues.
function splitStatements(sql) {
  // Strip line comments. The SQL here has no string literals containing
  // semicolons, so a naive split is safe.
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function migrate() {
  const statements = splitStatements(SQL);
  console.log(`[migrate] running ${statements.length} statements`);
  let ok = 0;
  let failed = 0;
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      ok++;
    } catch (e) {
      failed++;
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
      console.error(`[migrate] FAILED: ${preview}…`);
      console.error(`[migrate]   → ${e.message}`);
    }
  }
  console.log(`[migrate] schema ready (${ok} ok, ${failed} failed)`);
  return { ok, failed };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Always exit 0 so `npm start` proceeds to the server even if individual
  // statements failed — the server can still serve routes that don't depend
  // on the newest columns, and we'll see exactly what failed in the logs.
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error('[migrate] fatal:', e);
      pool.end().catch(() => {});
    });
}
