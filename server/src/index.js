import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import players from './routes/players.js';
import users from './routes/users.js';
import mocks from './routes/mocks.js';
import leaderboard from './routes/leaderboard.js';
import admin from './routes/admin.js';
import { pool } from './db/pool.js';

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
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

app.get('/api/settings', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM draft_settings WHERE id = 1');
  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS c FROM mocks');
  res.json({ ...rows[0], mock_count: countRows[0].c });
});

app.use('/api/players', players);
app.use('/api/users', users);
app.use('/api/mocks', mocks);
app.use('/api/leaderboard', leaderboard);
app.use('/api/admin', admin);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
