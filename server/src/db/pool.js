import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[pg] DATABASE_URL is not set');
    return {};
  }
  try {
    const parsed = new URL(url);
    const cfg = {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      database: parsed.pathname.replace(/^\//, ''),
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
    };
    console.log(
      `[pg] parsed DATABASE_URL → user=${cfg.user} host=${cfg.host} port=${cfg.port} db=${cfg.database}`
    );
    if (!cfg.password) {
      console.warn('[pg] parsed password is empty — check DATABASE_URL format');
    }
    return cfg;
  } catch (e) {
    console.error('[pg] Failed to parse DATABASE_URL:', e.message);
    return { connectionString: url };
  }
}

const cfg = buildConfig();
const useSsl = /rlwy\.net|railway|amazonaws|supabase|neon/.test(process.env.DATABASE_URL || '');

export const pool = new Pool({
  ...cfg,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  keepAlive: true,
  idleTimeoutMillis: 10_000,
  max: 5,
});

pool.on('error', (err) => {
  console.error('[pg pool] idle client error', err.message);
});
