import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool.js';

const router = Router();

// In-memory CSRF state store. Fine for single-instance server.
// Entries older than 10 minutes are swept on each callback.
const stateStore = new Map();

function getConfig() {
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return null;
  return { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET };
}

function getRedirectUri(req) {
  if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host');
  return `${proto}://${host}/api/auth/discord/callback`;
}

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
}

function redirectToFrontend(res, pathWithHash) {
  res.redirect(`${frontendUrl()}${pathWithHash}`);
}

// Kick off OAuth flow
router.get('/discord', (req, res) => {
  const cfg = getConfig();
  if (!cfg) {
    return redirectToFrontend(res, '/auth/callback#error=not_configured');
  }
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, Date.now());
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', cfg.DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', getRedirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'consent');
  res.redirect(url.toString());
});

// Discord redirects back here with ?code & ?state
router.get('/discord/callback', async (req, res) => {
  const cfg = getConfig();
  if (!cfg) return redirectToFrontend(res, '/auth/callback#error=not_configured');

  const { code, state, error } = req.query;
  if (error) return redirectToFrontend(res, `/auth/callback#error=${encodeURIComponent(error)}`);

  // Validate state (CSRF) + sweep old entries
  const now = Date.now();
  for (const [k, t] of stateStore) if (now - t > 600_000) stateStore.delete(k);
  if (!code || !state || !stateStore.has(state)) {
    return redirectToFrontend(res, '/auth/callback#error=invalid_state');
  }
  stateStore.delete(state);

  try {
    // Exchange code → access_token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.DISCORD_CLIENT_ID,
        client_secret: cfg.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: getRedirectUri(req),
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
    const { access_token } = await tokenRes.json();

    // Fetch Discord profile
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) throw new Error(`profile fetch failed (${meRes.status})`);
    const me = await meRes.json();

    const discordId = me.id;
    const preferredName = (me.global_name || me.username || 'player').slice(0, 60);
    const avatarUrl = me.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${me.avatar}.png?size=128`
      : null;

    // Upsert by discord_id
    const existing = await pool.query(
      'SELECT id, display_name FROM users WHERE discord_id = $1',
      [discordId]
    );

    let user;
    if (existing.rows.length) {
      user = existing.rows[0];
      await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, user.id]);
    } else {
      // Find an available display_name close to the Discord name
      let candidate = preferredName;
      for (let i = 0; i < 6; i++) {
        const r = await pool.query(
          'SELECT id FROM users WHERE LOWER(display_name) = LOWER($1)',
          [candidate]
        );
        if (!r.rows.length) break;
        const suffix = crypto.randomInt(100, 9999);
        candidate = `${preferredName.slice(0, 55)}-${suffix}`;
      }
      const ins = await pool.query(
        `INSERT INTO users (display_name, discord_id, avatar_url)
         VALUES ($1, $2, $3)
         RETURNING id, display_name`,
        [candidate, discordId, avatarUrl]
      );
      user = ins.rows[0];
    }

    // Send user back to frontend; id lives in the hash fragment so it's not
    // sent to servers or logged by proxies.
    return redirectToFrontend(res, `/auth/callback#id=${user.id}`);
  } catch (e) {
    console.error('[discord auth]', e);
    return redirectToFrontend(res, '/auth/callback#error=auth_failed');
  }
});

export default router;
