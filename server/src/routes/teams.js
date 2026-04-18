import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from '../db/pool.js';

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const NFL_TEAMS_PATH = join(__dirname, '..', 'data', 'nfl-teams.json');

// Lazy-loaded / cached static team list. Reads the JSON on first hit and
// keeps it in memory afterwards (small, changes rarely).
let teamsCache = null;
function loadTeams() {
  if (teamsCache) return teamsCache;
  try {
    teamsCache = JSON.parse(readFileSync(NFL_TEAMS_PATH, 'utf8'));
  } catch (e) {
    console.warn('[teams] nfl-teams.json read failed:', e.message);
    teamsCache = [];
  }
  return teamsCache;
}

// GET /api/teams — all 32 NFL teams with colors, logos, and current draft
// needs from the team_needs table. Needs are sorted by priority asc so the
// top-priority position comes first.
router.get('/', async (_req, res) => {
  try {
    const teams = loadTeams();
    const [{ rows: needs }, { rows: posScores }] = await Promise.all([
      pool.query(
        `SELECT team_id, position, priority
         FROM team_needs
         WHERE draft_year = 2026
         ORDER BY team_id, priority ASC`
      ),
      pool.query(
        `SELECT team_id, position, score
         FROM position_scores
         WHERE draft_year = 2026`
      ),
    ]);
    const needsByTeam = new Map();
    for (const n of needs) {
      if (!needsByTeam.has(n.team_id)) needsByTeam.set(n.team_id, []);
      needsByTeam.get(n.team_id).push({ position: n.position, priority: n.priority });
    }
    const scoresByTeam = new Map();
    for (const s of posScores) {
      if (!scoresByTeam.has(s.team_id)) scoresByTeam.set(s.team_id, {});
      scoresByTeam.get(s.team_id)[s.position] = s.score;
    }
    const enriched = teams.map((t) => ({
      ...t,
      needs: needsByTeam.get(t.id) || [],
      position_scores: scoresByTeam.get(t.id) || {},
    }));
    res.set('Cache-Control', 'public, max-age=300');
    res.json(enriched);
  } catch (e) {
    console.error('[teams]', e);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
