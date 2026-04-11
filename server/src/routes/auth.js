import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool.js';

const router = Router();

// In-memory CSRF state store. Fine for single-instance server.
// Entries older than 10 minutes are swept on each callback.
// Value shape: { provider, createdAt }
const stateStore = new Map();

// Per-provider OAuth config. Adding a new provider means adding an entry here
// plus the matching *_CLIENT_ID / *_CLIENT_SECRET env vars — no new routes.
const PROVIDERS = {
  discord: {
    name: 'discord',
    scope: 'identify',
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    profileUrl: 'https://discord.com/api/users/@me',
    envClientId: 'DISCORD_CLIENT_ID',
    envClientSecret: 'DISCORD_CLIENT_SECRET',
    envRedirectUri: 'DISCORD_REDIRECT_URI',
    defaultCallbackPath: '/api/auth/discord/callback',
    authExtraParams: { prompt: 'consent' },
    extractProfile(me) {
      return {
        providerAccountId: me.id,
        displayName: (me.global_name || me.username || 'player').slice(0, 60),
        email: me.email || null,
        avatarUrl: me.avatar
          ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128`
          : null,
      };
    },
  },
  google: {
    name: 'google',
    scope: 'openid email profile',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    envClientId: 'GOOGLE_CLIENT_ID',
    envClientSecret: 'GOOGLE_CLIENT_SECRET',
    envRedirectUri: 'GOOGLE_REDIRECT_URI',
    defaultCallbackPath: '/api/auth/google/callback',
    // select_account forces Google's account chooser each time so users on
    // shared machines don't silently sign in as whoever used the browser last.
    authExtraParams: { access_type: 'online', prompt: 'select_account' },
    extractProfile(me) {
      const base =
        me.name ||
        me.given_name ||
        (me.email ? me.email.split('@')[0] : 'player');
      return {
        providerAccountId: me.sub,
        displayName: String(base).slice(0, 60),
        email: me.email || null,
        avatarUrl: me.picture || null,
      };
    },
  },
};

function getProviderConfig(providerKey) {
  const p = PROVIDERS[providerKey];
  if (!p) return null;
  const clientId = process.env[p.envClientId];
  const clientSecret = process.env[p.envClientSecret];
  if (!clientId || !clientSecret) return null;
  return { ...p, clientId, clientSecret };
}

function getRedirectUri(req, provider) {
  const envUri = process.env[provider.envRedirectUri];
  if (envUri) return envUri;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host');
  return `${proto}://${host}${provider.defaultCallbackPath}`;
}

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
}

function redirectToFrontend(res, pathWithHash) {
  res.redirect(`${frontendUrl()}${pathWithHash}`);
}

// Kick off the OAuth flow for any configured provider.
router.get('/:provider', (req, res, next) => {
  const providerKey = req.params.provider;
  if (!PROVIDERS[providerKey]) return next();

  const cfg = getProviderConfig(providerKey);
  if (!cfg) {
    return redirectToFrontend(res, '/auth/callback#error=not_configured');
  }

  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { provider: providerKey, createdAt: Date.now() });

  const url = new URL(cfg.authUrl);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', getRedirectUri(req, cfg));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', state);
  for (const [k, v] of Object.entries(cfg.authExtraParams || {})) {
    url.searchParams.set(k, v);
  }
  res.redirect(url.toString());
});

// Handle the callback for any provider: exchange code → token → profile →
// upsert into users + user_identities, then bounce to the frontend with the
// user id in the URL hash so it isn't logged by intermediate proxies.
router.get('/:provider/callback', async (req, res, next) => {
  const providerKey = req.params.provider;
  if (!PROVIDERS[providerKey]) return next();

  const cfg = getProviderConfig(providerKey);
  if (!cfg) return redirectToFrontend(res, '/auth/callback#error=not_configured');

  const { code, state, error } = req.query;
  if (error) {
    return redirectToFrontend(res, `/auth/callback#error=${encodeURIComponent(error)}`);
  }

  // Validate state (CSRF) + sweep old entries. State is bound to the provider
  // it was issued for, so a Discord-issued state can't be reused to complete
  // a Google callback (or vice versa).
  const now = Date.now();
  for (const [k, v] of stateStore) {
    if (now - v.createdAt > 600_000) stateStore.delete(k);
  }
  const entry = state ? stateStore.get(state) : null;
  if (!code || !entry || entry.provider !== providerKey) {
    if (state) stateStore.delete(state);
    return redirectToFrontend(res, '/auth/callback#error=invalid_state');
  }
  stateStore.delete(state);

  try {
    // Exchange code → access_token
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: getRedirectUri(req, cfg),
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`${providerKey} token exchange failed (${tokenRes.status})`);
    }
    const { access_token } = await tokenRes.json();

    // Fetch the user's profile from the provider
    const meRes = await fetch(cfg.profileUrl, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) {
      throw new Error(`${providerKey} profile fetch failed (${meRes.status})`);
    }
    const me = await meRes.json();

    const profile = cfg.extractProfile(me);
    const preferredName = profile.displayName || 'player';

    // Look up existing identity by (provider, provider_account_id).
    const existingIdentity = await pool.query(
      `SELECT ui.user_id, u.display_name
       FROM user_identities ui
       JOIN users u ON u.id = ui.user_id
       WHERE ui.provider = $1 AND ui.provider_account_id = $2`,
      [providerKey, profile.providerAccountId]
    );

    let user;
    if (existingIdentity.rows.length) {
      user = {
        id: existingIdentity.rows[0].user_id,
        display_name: existingIdentity.rows[0].display_name,
      };
      // Keep the avatar + email in sync with what the provider just returned.
      await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [
        profile.avatarUrl,
        user.id,
      ]);
      await pool.query(
        `UPDATE user_identities SET avatar_url = $1, email = $2
         WHERE provider = $3 AND provider_account_id = $4`,
        [profile.avatarUrl, profile.email, providerKey, profile.providerAccountId]
      );
    } else {
      // New account: pick an available display_name close to the provider name.
      // We don't cross-link by email here — that's a separate account-linking
      // feature and requires verified-email guarantees we can't make for all
      // providers today.
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
      // Note: users.email is left NULL on insert. The real email (if any)
      // lives on the user_identities row so we don't trip the users.email
      // UNIQUE constraint when two providers report the same address.
      const ins = await pool.query(
        `INSERT INTO users (display_name, avatar_url)
         VALUES ($1, $2)
         RETURNING id, display_name`,
        [candidate, profile.avatarUrl]
      );
      user = ins.rows[0];
      await pool.query(
        `INSERT INTO user_identities
           (user_id, provider, provider_account_id, email, avatar_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, providerKey, profile.providerAccountId, profile.email, profile.avatarUrl]
      );
    }

    // Send user back to the frontend; id lives in the hash fragment so it's
    // not sent to servers or logged by proxies.
    return redirectToFrontend(res, `/auth/callback#id=${user.id}`);
  } catch (e) {
    console.error(`[${providerKey} auth]`, e);
    return redirectToFrontend(res, '/auth/callback#error=auth_failed');
  }
});

export default router;
