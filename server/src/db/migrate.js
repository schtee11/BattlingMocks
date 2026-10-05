import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { pool } from './pool.js';
import { CURRENT_DRAFT_YEAR } from '../config.js';
import { importProspects, seedDraftOrder, seedTeamNeeds } from './seed.js';

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
-- Partial unique: only the round1 showdown is capped at one per user (per
-- draft year — see the Phase 10 mocks_round1_user_year_unique index below).
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

-- Roster heatmap: per-team, per-position 1–10 score. Complements team_needs
-- (which is a ranked top-3 list) by giving the bot a full 12-position view of
-- how stocked each team is. 1 = non roster worthy, 10 = elite + depth. The
-- bot reads these scores and boosts picks for positions where the team is
-- deficient (low score). Canonical positions match normalizePos() output
-- plus NCB (slot/nickel corner) which is tracked as its own bucket.
CREATE TABLE IF NOT EXISTS position_scores (
  id SERIAL PRIMARY KEY,
  team_id VARCHAR(5) NOT NULL,
  team_name VARCHAR(80) NOT NULL,
  position VARCHAR(10) NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  draft_year INTEGER DEFAULT 2026,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, position, draft_year)
);
CREATE INDEX IF NOT EXISTS idx_position_scores_team_year ON position_scores(team_id, draft_year);

-- Phase 7: role-based admin access. Default FALSE so existing users aren't
-- promoted accidentally. Admins are promoted via a SQL UPDATE or the admin panel.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- Phase 6 indexes
CREATE INDEX IF NOT EXISTS idx_players_draft_year_rank
  ON players(draft_year, consensus_rank) WHERE consensus_rank IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_draft_order_year_pick ON draft_order(draft_year, pick_number);

-- Phase 8: multi-year draft_order. The original PK was just pick_number, so
-- only one year could live in the table at a time. Now that 2027 picks are
-- pulled from ESPN alongside 2026 (same mechanism, admin /sync/draft-order-all
-- with ?year=2027), the PK is composite (pick_number, draft_year) so both
-- years coexist. Existing rows got draft_year=2026 from the DEFAULT when that
-- column was added, so no data migration is needed — just the PK flip.
UPDATE draft_order SET draft_year = 2026 WHERE draft_year IS NULL;
ALTER TABLE draft_order ALTER COLUMN draft_year SET NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.key_column_usage
     WHERE constraint_name = 'draft_order_pkey'
       AND table_name = 'draft_order'
       AND column_name = 'pick_number'
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.key_column_usage
     WHERE constraint_name = 'draft_order_pkey'
       AND table_name = 'draft_order'
       AND column_name = 'draft_year'
  ) THEN
    ALTER TABLE draft_order DROP CONSTRAINT draft_order_pkey;
    ALTER TABLE draft_order ADD CONSTRAINT draft_order_pkey PRIMARY KEY (pick_number, draft_year);
  END IF;
END$$;

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

-- Phase 8: User Big Boards. Each board belongs to one user and stores an
-- ordered list of explicitly-ranked prospects. Unranked players are
-- auto-completed at read time using the default consensus_rank ordering, so
-- the DB only stores what the user actually touched.
CREATE TABLE IF NOT EXISTS user_boards (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(100) NOT NULL DEFAULT 'My Board',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_boards_user_id ON user_boards(user_id);

CREATE TABLE IF NOT EXISTS user_board_rankings (
  board_id  INTEGER NOT NULL REFERENCES user_boards(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL,
  PRIMARY KEY (board_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_ubr_board_rank ON user_board_rankings(board_id, rank);

-- Phase 9: prediction mocks. Sandbox R1 mocks stored per-user with picks and
-- trade state as JSONB (no need for individual pick rows since they're not
-- scored). Up to 10 per user, enforced at the API level.
CREATE TABLE IF NOT EXISTS prediction_mocks (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL DEFAULT 'Untitled Mock',
  picks JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_order JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prediction_mocks_user ON prediction_mocks(user_id);

-- Phase 9b: prediction_mocks usage telemetry. Append-only event log covering
-- both CRUD on saved mocks (create/update/delete) and UI-initiated actions
-- (load/export/download/share) — including events from guests (user_id NULL)
-- and from unsaved boards (mock_id NULL) so we can understand the full
-- usage funnel, not just persisted slots. ON DELETE SET NULL on both FKs so
-- deleting a user or a mock preserves the historical event count.
CREATE TABLE IF NOT EXISTS prediction_mock_events (
  id BIGSERIAL PRIMARY KEY,
  mock_id INTEGER REFERENCES prediction_mocks(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(20) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prediction_mock_events_type_time
  ON prediction_mock_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_mock_events_created_at
  ON prediction_mock_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_mock_events_user
  ON prediction_mock_events(user_id);
CREATE INDEX IF NOT EXISTS idx_prediction_mock_events_mock
  ON prediction_mock_events(mock_id);

-- Phase 10: multi-season support. Every season-scoped table carries a
-- draft_year so a new draft (2027, 2028, …) starts with a clean slate while
-- prior seasons' mocks, actual results and leaderboard stay queryable. The
-- ADD COLUMN DEFAULT 2026 backfills every pre-existing row to the 2026 draft
-- (the only season that existed before this phase); the SET DEFAULT that
-- follows points new rows at the current season.
ALTER TABLE mocks ADD COLUMN IF NOT EXISTS draft_year INTEGER DEFAULT 2026;
UPDATE mocks SET draft_year = 2026 WHERE draft_year IS NULL;
ALTER TABLE mocks ALTER COLUMN draft_year SET NOT NULL;
ALTER TABLE mocks ALTER COLUMN draft_year SET DEFAULT __YEAR__;
-- One scored R1 showdown per user PER SEASON (was one per user, ever).
DROP INDEX IF EXISTS mocks_round1_user_unique;
CREATE UNIQUE INDEX IF NOT EXISTS mocks_round1_user_year_unique
  ON mocks(user_id, draft_year) WHERE mock_type = 'round1';
CREATE INDEX IF NOT EXISTS idx_mocks_year_type ON mocks(draft_year, mock_type);

ALTER TABLE actual_picks ADD COLUMN IF NOT EXISTS draft_year INTEGER DEFAULT 2026;
UPDATE actual_picks SET draft_year = 2026 WHERE draft_year IS NULL;
ALTER TABLE actual_picks ALTER COLUMN draft_year SET NOT NULL;
ALTER TABLE actual_picks ALTER COLUMN draft_year SET DEFAULT __YEAR__;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.key_column_usage
     WHERE constraint_name = 'actual_picks_pkey'
       AND table_name = 'actual_picks'
       AND column_name = 'pick_number'
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.key_column_usage
     WHERE constraint_name = 'actual_picks_pkey'
       AND table_name = 'actual_picks'
       AND column_name = 'draft_year'
  ) THEN
    ALTER TABLE actual_picks DROP CONSTRAINT actual_picks_pkey;
    ALTER TABLE actual_picks ADD CONSTRAINT actual_picks_pkey PRIMARY KEY (pick_number, draft_year);
  END IF;
END$$;

ALTER TABLE prediction_mocks ADD COLUMN IF NOT EXISTS draft_year INTEGER DEFAULT 2026;
ALTER TABLE prediction_mocks ALTER COLUMN draft_year SET DEFAULT __YEAR__;
CREATE INDEX IF NOT EXISTS idx_prediction_mocks_user_year ON prediction_mocks(user_id, draft_year);

ALTER TABLE user_boards ADD COLUMN IF NOT EXISTS draft_year INTEGER DEFAULT 2026;
ALTER TABLE user_boards ALTER COLUMN draft_year SET DEFAULT __YEAR__;
CREATE INDEX IF NOT EXISTS idx_user_boards_user_year ON user_boards(user_id, draft_year);

ALTER TABLE players ALTER COLUMN draft_year SET DEFAULT __YEAR__;

-- One-shot data fixes run from migrate() — each key runs at most once.
CREATE TABLE IF NOT EXISTS schema_tasks (
  key VARCHAR(100) PRIMARY KEY,
  ran_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE draft_order ALTER COLUMN draft_year SET DEFAULT __YEAR__;
ALTER TABLE team_needs ALTER COLUMN draft_year SET DEFAULT __YEAR__;
ALTER TABLE position_scores ALTER COLUMN draft_year SET DEFAULT __YEAR__;
`.replaceAll('__YEAR__', String(CURRENT_DRAFT_YEAR));

// Split the migration SQL into individual statements and run them one at a
// time so a single failing DDL (due to legacy constraints, weird data, etc.)
// doesn't nuke the entire schema deploy. Failures are logged loudly but the
// rest of the migration continues.
//
// Handles PostgreSQL dollar-quoted blocks (`$$…$$`) so DO/function bodies
// that contain semicolons aren't shattered into fragments.
function splitStatements(sql) {
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '$' && stripped[i + 1] === '$') {
      buf += '$$';
      i++;
      inDollar = !inDollar;
      continue;
    }
    if (c === ';' && !inDollar) {
      const s = buf.trim();
      if (s.length > 0) statements.push(s);
      buf = '';
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

function readSeasonFile(name, year) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const path = join(__dirname, '..', 'data', `${name}-${year}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function countFor(table, year, extra = '') {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ${table} WHERE draft_year = $1 ${extra}`,
    [year]
  );
  return rows[0]?.c ?? 0;
}

// Season bootstrap. Runs on every deploy and fills in whatever the current
// draft year is missing from the static JSON under src/data — prospects,
// Round 1 order, team needs and roster scores — then points draft_settings
// at the new season (unlocked, scoring cleared). Every step only writes when
// the year has no data yet, so admin edits made through the panel are never
// clobbered by a later deploy. Each step is isolated so one missing file
// doesn't block the rest.
async function seedSeason(year) {
  const step = async (label, fn) => {
    try {
      const msg = await fn();
      if (msg) console.log(`[migrate] ${year} ${label}: ${msg}`);
    } catch (e) {
      console.warn(`[migrate] ${year} ${label} skipped:`, e.message);
    }
  };

  await step('prospects', async () => {
    const have = await countFor('players', year);
    if (have > 0) return `already populated (${have} players)`;
    const r = await importProspects(readSeasonFile('prospects', year), year);
    return `seeded ${r.added} added, ${r.updated} updated`;
  });

  await step('draft_order R1', async () => {
    const have = await countFor('draft_order', year, 'AND round = 1');
    if (have >= 32) return `already populated (${have} R1 picks)`;
    const order = readSeasonFile('draft-order', year);
    await seedDraftOrder(order, year);
    return `seeded ${order.length} R1 picks`;
  });

  await step('team_needs', async () => {
    const have = await countFor('team_needs', year);
    if (have > 0) return `already populated (${have} rows)`;
    const r = await seedTeamNeeds(readSeasonFile('team-needs', year), year);
    return `seeded ${r.upserted} rows`;
  });

  // Rounds 2–7 normally come from ESPN (admin → /sync/draft-order-all), but
  // ESPN often hasn't published them early in the season. Until it does, lay
  // down a standard straight-rotation order — each round follows Round 1's
  // order by ORIGINAL team, no comp picks — so the 7-round team mock works on
  // day one. Only runs when the year has no R2+ rows at all; the ESPN sync
  // upserts by pick number and overwrites these placeholders.
  await step('draft_order R2-R7', async () => {
    const have = await countFor('draft_order', year, 'AND round > 1');
    if (have > 0) return `already populated (${have} rows)`;
    const { rows: r1 } = await pool.query(
      `SELECT pick_number, COALESCE(original_team_id, team) AS team
         FROM draft_order WHERE draft_year = $1 AND round = 1
        ORDER BY pick_number`,
      [year]
    );
    if (r1.length !== 32) return `skipped (need 32 R1 picks, have ${r1.length})`;
    const { rows: names } = await pool.query(
      `SELECT DISTINCT ON (team_id) team_id, team_name FROM team_needs WHERE draft_year = $1`,
      [year]
    );
    const nameOf = new Map(names.map((n) => [n.team_id, n.team_name]));
    let inserted = 0;
    for (let round = 2; round <= 7; round++) {
      for (let i = 0; i < 32; i++) {
        const team = r1[i].team;
        await pool.query(
          `INSERT INTO draft_order (pick_number, team, team_name, team_needs, round, draft_year)
           VALUES ($1, $2, $3, ARRAY[]::TEXT[], $4, $5)
           ON CONFLICT (pick_number, draft_year) DO NOTHING`,
          [(round - 1) * 32 + i + 1, team, nameOf.get(team) || team, round, year]
        );
        inserted++;
      }
    }
    return `generated ${inserted} placeholder picks (sync from ESPN to replace)`;
  });

  // Roster heatmap: per-team, per-position 1–10 scores.
  await step('position_scores', async () => {
    const have = await countFor('position_scores', year);
    if (have > 0) return `already populated (${have} rows)`;
    let inserted = 0;
    for (const t of readSeasonFile('position-scores', year)) {
      const teamName = t.teamName || t.teamId;
      for (const [position, score] of Object.entries(t.scores || {})) {
        const v = Number(score);
        if (!Number.isInteger(v) || v < 1 || v > 10) continue;
        await pool.query(
          `INSERT INTO position_scores (team_id, team_name, position, score, draft_year)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (team_id, position, draft_year) DO NOTHING`,
          [t.teamId, teamName, String(position).toUpperCase(), v, year]
        );
        inserted++;
      }
    }
    return `seeded ${inserted} rows`;
  });

  // One-shot repair for the first 2027 ESPN prospect sync, which imported
  // ~400 unresolved ESPN athlete stubs (no school, position fell back to
  // ATH, names like "- 33") and gave them ranks that collided with the real
  // board. Archive the stubs (draft_year → NULL, so they drop off every
  // year-filtered query while mocks / bot telemetry that already reference
  // them keep a valid row), then restore consensus ranks from the file.
  await step('cleanup espn stubs', async () => {
    const key = `cleanup-espn-stubs-${year}`;
    const { rows: done } = await pool.query('SELECT 1 FROM schema_tasks WHERE key = $1', [key]);
    if (done.length) return null;
    const file = readSeasonFile('prospects', year);
    const names = file.map((p) => String(p.name).toLowerCase());
    const { rowCount: archived } = await pool.query(
      `UPDATE players SET draft_year = NULL
        WHERE draft_year = $1
          AND LOWER(name) <> ALL($2::text[])
          AND (position = 'ATH' OR school IS NULL OR name !~ '[A-Za-z]{2}')`,
      [year, names]
    );
    let reranked = 0;
    for (const p of file) {
      const { rowCount } = await pool.query(
        `UPDATE players SET consensus_rank = $1
          WHERE draft_year = $2 AND LOWER(name) = LOWER($3) AND consensus_rank IS DISTINCT FROM $1`,
        [p.rank, year, p.name]
      );
      reranked += rowCount;
    }
    await pool.query('INSERT INTO schema_tasks (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
    return `archived ${archived} stub players, restored ${reranked} ranks`;
  });

  // New season → reopen submissions. Only fires once per rollover (when the
  // stored year is behind), so a lock the admin sets mid-season sticks.
  await step('draft_settings', async () => {
    const { rowCount } = await pool.query(
      `UPDATE draft_settings
          SET draft_year = $1, is_locked = FALSE, scoring_run_at = NULL
        WHERE id = 1 AND (draft_year IS NULL OR draft_year < $1)`,
      [year]
    );
    return rowCount ? 'rolled over to new season (unlocked)' : null;
  });
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
  await seedSeason(CURRENT_DRAFT_YEAR);
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
