import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import players from './routes/players.js';
import users from './routes/users.js';
import mocks from './routes/mocks.js';
import leaderboard from './routes/leaderboard.js';
import admin from './routes/admin.js';
import draftOrder from './routes/draftOrder.js';
import stats from './routes/stats.js';
import actuals from './routes/actuals.js';
import auth from './routes/auth.js';
import teamMocks from './routes/teamMocks.js';
import tradeValues from './routes/tradeValues.js';
import imageProxy from './routes/imageProxy.js';
import { pool } from './db/pool.js';

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS: accept FRONTEND_URL as a comma-separated list. Local dev + prod can
// coexist. If nothing is set, reflect the request origin (dev only).
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Allow curl/Postman (no origin) and anything in the allow-list
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: false,
  })
);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// Build stamp — lets us verify which revision is live by hitting /version
const BUILD_STAMP = {
  started_at: new Date().toISOString(),
  git_sha: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || 'unknown',
};
app.get('/version', (_req, res) => res.json(BUILD_STAMP));

// Request-level log for production diagnostics. Writes to stdout which
// Railway tails into the deployment logs, so every hit (including the
// failing POST /api/team-mocks) should surface here.
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.originalUrl}`);
  next();
});

app.get('/api/settings', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM draft_settings WHERE id = 1');
    const { rows: countRows } = await pool.query(
      "SELECT COUNT(*)::int AS c FROM mocks WHERE mock_type = 'round1'"
    );
    res.json({ ...rows[0], mock_count: countRows[0].c });
  } catch (e) {
    console.error('[settings]', e);
    res.status(500).json({ error: 'server error' });
  }
});

app.use('/api/players', players);
app.use('/api/users', users);
app.use('/api/mocks', mocks);
app.use('/api/leaderboard', leaderboard);
app.use('/api/admin', admin);
app.use('/api/draft-order', draftOrder);
app.use('/api/stats', stats);
app.use('/api/actual-picks', actuals);
app.use('/api/auth', auth);
app.use('/api/team-mocks', teamMocks);
app.use('/api/trade-values', tradeValues);
app.use('/api/proxy/image', imageProxy);

// Catch-all 404 — log the path so Railway deploy logs show exactly what
// route missed. Critical for debugging the "POST /api/team-mocks 404"
// deployment issue.
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'not found', path: req.originalUrl });
});

// Consistent error fallback
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server] ══════════════════════════════════════════`);
  console.log(`[server] listening on :${PORT}`);
  console.log(`[server] started at ${BUILD_STAMP.started_at}`);
  console.log(`[server] git sha    ${BUILD_STAMP.git_sha}`);
  // Dump registered routes. Wrapped in try/catch so a route-dump bug can
  // never crash the listen callback.
  try {
    const registered = [];
    for (const layer of app._router?.stack || []) {
      if (layer.name === 'router' && layer.regexp) {
        const base = layer.regexp.toString()
          .replace('/^\\', '')
          .replace('\\/?(?=\\/|$)/i', '')
          .replace(/\\\//g, '/');
        for (const r of layer.handle.stack || []) {
          if (r.route) {
            const method = Object.keys(r.route.methods)[0]?.toUpperCase();
            registered.push(`${method} ${base}${r.route.path}`);
          }
        }
      }
    }
    console.log(`[server] ${registered.length} routes registered`);
    for (const r of registered.sort()) console.log(`  ${r}`);
  } catch (e) {
    console.warn('[server] route dump failed:', e.message);
  }
  console.log(`[server] ══════════════════════════════════════════`);
});
