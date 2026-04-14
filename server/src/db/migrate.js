import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
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

-- Multi-provider auth: each row is one external identity (Discord, Google, etc.)
-- linked to a user. Primary key is (provider, provider_account_id) so a given
-- external account maps to exactly one user. Users can have multiple identities
-- linked to them, which is the hook for future account-linking. The legacy
-- users.discord_id column is preserved and backfilled below, but new code
-- reads/writes exclusively through user_identities.
CREATE TABLE IF NOT EXISTS user_identities (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (provider, provider_account_id)
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);

-- Backfill existing Discord accounts into user_identities. Idempotent thanks
-- to the ON CONFLICT clause — safe to run on every deploy.
INSERT INTO user_identities (user_id, provider, provider_account_id, avatar_url)
SELECT id, 'discord', discord_id, avatar_url
FROM users
WHERE discord_id IS NOT NULL
ON CONFLICT (provider, provider_account_id) DO NOTHING;

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

-- Algo config: admin-editable JSON blob that drives the bot picker and trade
-- acceptance engine. Stored as overrides; the server/client merge with defaults.
ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS algo_config JSONB DEFAULT '{}'::jsonb;

INSERT INTO draft_settings (id, draft_year, is_locked)
VALUES (1, 2026, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Phase 5: draft-session telemetry. Every mock draft (saved or abandoned,
-- authenticated or anonymous) creates a draft_sessions row, and every pick
-- (user and bot) logs into draft_session_picks. This is an append-only log
-- layer separate from mocks / mock_picks, which remain the explicitly
-- curated save concept. Anonymous sessions are allowed (user_id NULLABLE)
-- so we capture all traffic, not just logged-in users.
CREATE TABLE IF NOT EXISTS draft_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_uuid UUID NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  mock_type VARCHAR(20) NOT NULL,
  user_team VARCHAR(5),
  randomness REAL,
  algo_config_snapshot JSONB DEFAULT '{}'::jsonb,
  draft_year INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS draft_session_picks (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES draft_sessions(id) ON DELETE CASCADE,
  pick_number INTEGER NOT NULL CHECK (pick_number BETWEEN 1 AND 262),
  round INTEGER NOT NULL,
  team VARCHAR(5) NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  is_user BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id, pick_number)
);

CREATE INDEX IF NOT EXISTS idx_draft_sessions_started_at ON draft_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_draft_sessions_user_id ON draft_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_draft_sessions_mock_type ON draft_sessions(mock_type);
CREATE INDEX IF NOT EXISTS idx_draft_session_picks_session ON draft_session_picks(session_id);
CREATE INDEX IF NOT EXISTS idx_draft_session_picks_player ON draft_session_picks(player_id);
-- Partial index: the hot path for consensus-board analysis is "at pick N,
-- what have users picked?" — so index only user picks by (pick_number, player_id).
CREATE INDEX IF NOT EXISTS idx_draft_session_picks_consensus
  ON draft_session_picks(pick_number, player_id) WHERE is_user = TRUE;

CREATE INDEX IF NOT EXISTS idx_mocks_user_id ON mocks(user_id);
CREATE INDEX IF NOT EXISTS idx_mocks_total_score ON mocks(total_score DESC, submitted_at ASC);
CREATE INDEX IF NOT EXISTS idx_mock_picks_mock_id ON mock_picks(mock_id);
CREATE INDEX IF NOT EXISTS idx_mock_picks_player_id ON mock_picks(player_id);
CREATE INDEX IF NOT EXISTS idx_actual_picks_player ON actual_picks(player_id);
CREATE INDEX IF NOT EXISTS idx_users_display_name_lower ON users (LOWER(display_name));

-- ---------------------------------------------------------------------------
-- Phase 6 (Enterprise Upgrade): additive-only schema changes.
--
-- Ground rules: every statement below is idempotent (ADD COLUMN IF NOT EXISTS
-- / CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) and every new
-- column has a safe default so existing rows don't need backfill. We do NOT
-- recreate or modify existing tables here — see "skipped" note at the bottom.
-- ---------------------------------------------------------------------------

-- Confidence picks on predictive R1 mocks. Up to 3 per mock (enforced in the
-- submit route). An exact match on a confident pick gets a 1.5x multiplier.
ALTER TABLE mock_picks ADD COLUMN IF NOT EXISTS is_confident BOOLEAN DEFAULT FALSE;

-- Extended prospect metadata. All nullable / defaulted so seed data without
-- these fields still imports cleanly.
ALTER TABLE players ADD COLUMN IF NOT EXISTS height VARCHAR(10);
ALTER TABLE players ADD COLUMN IF NOT EXISTS weight INTEGER;
ALTER TABLE players ADD COLUMN IF NOT EXISTS projected_round INTEGER;
ALTER TABLE players ADD COLUMN IF NOT EXISTS consensus_rank INTEGER;
ALTER TABLE players ADD COLUMN IF NOT EXISTS draft_year INTEGER DEFAULT 2026;
ALTER TABLE players ADD COLUMN IF NOT EXISTS strengths TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS weaknesses TEXT;

-- Draft-order extras for 7-round compensatory/original-team tracking.
ALTER TABLE draft_order ADD COLUMN IF NOT EXISTS is_compensatory BOOLEAN DEFAULT FALSE;
ALTER TABLE draft_order ADD COLUMN IF NOT EXISTS original_team_id VARCHAR(5);
ALTER TABLE draft_order ADD COLUMN IF NOT EXISTS draft_year INTEGER DEFAULT 2026;

-- Phase 6: dedicated team-needs table keyed by (team_id, draft_year, position).
-- Decouples editable needs from draft_order rows so admins can manage team
-- needs once per team instead of per-pick. draft_order.team_needs still works
-- as a legacy fast-read cache; new UI reads from this table.
CREATE TABLE IF NOT EXISTS team_needs (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(5) NOT NULL,
  team_name VARCHAR(80) NOT NULL,
  position VARCHAR(10) NOT NULL,
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 3),
  draft_year INTEGER DEFAULT 2026,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, position, draft_year)
);
CREATE INDEX IF NOT EXISTS idx_team_needs_team_year ON team_needs(team_id, draft_year);

-- Phase 7: role-based admin access. Default FALSE so existing users aren't
-- promoted accidentally. Admins are promoted via a SQL UPDATE or the admin panel.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- Phase 6 indexes
CREATE INDEX IF NOT EXISTS idx_players_draft_year_rank
  ON players(draft_year, consensus_rank) WHERE consensus_rank IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_draft_order_year_pick ON draft_order(draft_year, pick_number);

-- ---------------------------------------------------------------------------
-- INTENTIONALLY SKIPPED (would duplicate existing functionality):
--   * team_mocks / team_mock_picks tables — the existing 'mocks' table
--     already stores team mocks via mock_type='team' + team_abbr + trades
--     JSONB column, and mock_picks handles the per-pick rows (1..262). The
--     team-mocks route (server/src/routes/teamMocks.js) already implements
--     listing/saving/deleting through those columns. Creating separate
--     team_mocks tables would require rewriting the working team-mock flow
--     and migrating existing saves.
--     TODO: confirm with WillyT that the unified mocks table is OK long-term.
--   * team_mock_trades table — trades are persisted as JSONB on mocks.trades.
-- ---------------------------------------------------------------------------
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
  // Phase 6: auto-seed team_needs from the static JSON file if the table is
  // empty. This runs on every deploy so the UI always has data after a fresh
  // migrate. It's idempotent — we only insert if the table is empty, so an
  // admin can edit needs in the panel without migrations clobbering them.
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM team_needs');
    if ((rows[0]?.c ?? 0) === 0) {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const path = join(__dirname, '..', 'data', 'team-needs-2026.json');
      const data = JSON.parse(readFileSync(path, 'utf8'));
      let inserted = 0;
      for (const t of data) {
        const teamId = t.teamId;
        const teamName = t.teamName || teamId;
        for (const n of t.needs || []) {
          if (!Number.isInteger(n.priority) || n.priority < 1 || n.priority > 3) continue;
          await pool.query(
            `INSERT INTO team_needs (team_id, team_name, position, priority, draft_year)
             VALUES ($1, $2, $3, $4, 2026)
             ON CONFLICT (team_id, position, draft_year) DO NOTHING`,
            [teamId, teamName, String(n.position).toUpperCase(), n.priority]
          );
          inserted++;
        }
      }
      console.log(`[migrate] team_needs seeded: ${inserted} rows`);
    } else {
      console.log(`[migrate] team_needs already populated (${rows[0].c} rows)`);
    }
  } catch (e) {
    console.warn('[migrate] team_needs seed skipped:', e.message);
  }
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
