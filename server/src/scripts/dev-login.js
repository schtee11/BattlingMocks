/**
 * Local dev only — creates a test user and prints a browser console
 * command to log in without OAuth. Never commit tokens from this script.
 *
 * Usage: node src/scripts/dev-login.js
 */
import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../db/pool.js';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('JWT_SECRET not set in .env'); process.exit(1); }

const DISPLAY_NAME = 'DevUser';

const { rows } = await pool.query(
  `INSERT INTO users (display_name, is_admin)
   VALUES ($1, TRUE)
   ON CONFLICT (display_name) DO UPDATE SET display_name = EXCLUDED.display_name
   RETURNING id, display_name, avatar_url, created_at`,
  [DISPLAY_NAME]
);
const user = rows[0];

const token = jwt.sign({ sub: user.id }, SECRET, { expiresIn: '7d' });

// mds_user is what useAuth reads immediately on load (no async call needed)
const mdsUser = JSON.stringify({ id: user.id, display_name: user.display_name, avatar_url: user.avatar_url, created_at: user.created_at });

console.log('\n✅ Dev user ready:', user.display_name, '(', user.id, ')');
console.log('\nPaste this into your browser console at http://localhost:5173:\n');
console.log(`localStorage.setItem('mds_token', '${token}'); localStorage.setItem('mds_user', '${mdsUser}'); location.reload();`);
console.log('');

await pool.end();
