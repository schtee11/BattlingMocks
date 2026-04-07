import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /rlwy\.net|railway|amazonaws|supabase|neon/.test(process.env.DATABASE_URL || '')
    ? { rejectUnauthorized: false }
    : false,
  keepAlive: true,
  idleTimeoutMillis: 10_000,
  max: 5,
});

pool.on('error', (err) => {
  console.error('[pg pool] idle client error', err.message);
});
