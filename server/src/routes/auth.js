import { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import {
  setAuthCookies,
  clearAuthCookies,
  requireAuth,
} from '../middleware/requireAuth.js';

const router = Router();

// Strict rate limit on OAuth initiation to prevent redirect-flood abuse.
const oauthInitLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many sign-in attempts, please wait a minute' },
});

// In-memory CSRF state store. Fine for single-instance server.
// Entries older than 10 minutes are swept on each callback.
// Value shape: { provider, createdAt, intent?: 'link', linkingUserId?: string }
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

// Kick off the OAuth flow for any configured provider. Supports two modes:
//   - Normal sign-in: GET /api/auth/:provider
//   - Link intent:    GET /api/auth/:provider?link=1&user=<uuid>
// Link intent attaches the resulting identity to an existing user instead of
// creating a new one. The user id is stashed in the state token so the
// callback knows who to link to. Security note: this trusts the client's
// assertion of user id (same threat model as the rest of the app's
// localStorage-based session). If the session model is upgraded later, this
// should be replaced with a server-validated session.
router.get('/:provider', oauthInitLimit, async (req, res, next) => {
  const providerKey = req.params.provider;
  if (!PROVIDERS[providerKey]) return next();

  const cfg = getProviderConfig(providerKey);
  if (!cfg) {
    return redirectToFrontend(res, '/auth/callback#error=not_configured');
  }

  // Link-intent validation: the target user must exist.
  const isLink = req.query.link === '1';
  let linkingUserId = null;
  if (isLink) {
    const rawUser = typeof req.query.user === 'string' ? req.query.user : null;
    if (!rawUser) {
      return redirectToFrontend(res, '/auth/callback#error=link_user_missing');
    }
    try {
      const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [rawUser]);
      if (!rows.length) {
        return redirectToFrontend(res, '/auth/callback#error=link_user_missing');
      }
      linkingUserId = rows[0].id;
    } catch (e) {
      console.error('[auth link init]', e);
      return redirectToFrontend(res, '/auth/callback#error=auth_failed');
    }
  }

  const state = crypto.randomBytes(16).toString('hex');
  const entry = { provider: providerKey, createdAt: Date.now() };
  if (isLink) {
    entry.intent = 'link';
    entry.linkingUserId = linkingUserId;
  }
  stateStore.set(state, entry);

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

    // ---- Link intent branch -----------------------------------------------
    // The user was already authenticated and initiated a link flow from
    // /settings. Attach the new identity to that existing user instead of
    // creating a new one.
    if (entry.intent === 'link') {
      const targetUserId = entry.linkingUserId;

      if (existingIdentity.rows.length) {
        const boundUserId = existingIdentity.rows[0].user_id;
        if (boundUserId === targetUserId) {
          // Idempotent: re-linking the same identity is a no-op success.
          return redirectToFrontend(res, `/auth/callback#linked=already&provider=${providerKey}`);
        }
        // Already linked to a different user — refuse rather than overwrite.
        return redirectToFrontend(
          res,
          `/auth/callback#error=already_linked_other&provider=${providerKey}`
        );
      }

      // Not linked yet — attach to the target user.
      await pool.query(
        `INSERT INTO user_identities
           (user_id, provider, provider_account_id, email, avatar_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetUserId, providerKey, profile.providerAccountId, profile.email, profile.avatarUrl]
      );
      return redirectToFrontend(
        res,
        `/auth/callback#linked=1&provider=${providerKey}&id=${targetUserId}`
      );
    }

    // ---- Normal sign-in branch --------------------------------------------
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

    // Set HttpOnly JWT cookies so the server can validate subsequent requests.
    const { refresh } = setAuthCookies(res, user.id);
    // The id + a long-lived token are passed in the hash so the frontend can
    // store the token for mobile browsers where cross-origin cookies are
    // blocked (Safari ITP, private browsing). The hash fragment is never sent
    // to servers or logged by proxies. Desktop browsers that support cookies
    // will use cookies; the token is a fallback sent as Authorization: Bearer.
    return redirectToFrontend(res, `/auth/callback#id=${user.id}&token=${refresh}`);
  } catch (e) {
    console.error(`[${providerKey} auth]`, e);
    return redirectToFrontend(res, '/auth/callback#error=auth_failed');
  }
});

// ---------------------------------------------------------------------------
// Identity management — list + unlink linked providers for a user. Used by
// the Account Settings page. These endpoints trust the caller's assertion
// of user id (same session model as the rest of the app). When the session
// model is hardened, add auth middleware here.
// ---------------------------------------------------------------------------

// List all linked providers for a user (authenticated, owner only).
router.get('/users/:userId/identities', requireAuth, async (req, res) => {
  const { userId } = req.params;
  if (req.userId !== userId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const { rows: userRows } = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userRows.length) return res.status(404).json({ error: 'user not found' });

    const { rows } = await pool.query(
      `SELECT provider, provider_account_id, email, avatar_url, created_at
       FROM user_identities
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
    // Return the full catalog of configured providers so the UI can render
    // both "linked" and "available to link" states from one payload.
    const configured = Object.keys(PROVIDERS).filter((k) => !!getProviderConfig(k));
    res.json({
      identities: rows,
      available_providers: configured,
    });
  } catch (e) {
    console.error('[auth identities list]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Unlink a provider from a user (authenticated, owner only). Refuses to
// remove the user's last remaining identity (that would lock them out).
router.delete('/users/:userId/identities/:provider', requireAuth, async (req, res) => {
  const { userId, provider } = req.params;
  if (req.userId !== userId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!PROVIDERS[provider]) return res.status(400).json({ error: 'unknown provider' });

  try {
    const { rows: userRows } = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userRows.length) return res.status(404).json({ error: 'user not found' });

    const { rows: allIdents } = await pool.query(
      'SELECT provider FROM user_identities WHERE user_id = $1',
      [userId]
    );
    if (allIdents.length <= 1) {
      return res.status(400).json({ error: 'cannot_unlink_last' });
    }
    const targetExists = allIdents.some((r) => r.provider === provider);
    if (!targetExists) {
      return res.status(404).json({ error: 'identity not linked' });
    }

    await pool.query(
      'DELETE FROM user_identities WHERE user_id = $1 AND provider = $2',
      [userId, provider]
    );
    res.status(204).end();
  } catch (e) {
    console.error('[auth identities unlink]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------------------------------------------------------------------------
// Session endpoints — cookie-based JWT auth
// ---------------------------------------------------------------------------

// GET /api/auth/me — return the current authenticated user from the JWT cookie.
// Used on page load to hydrate the client auth state without localStorage.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, display_name, avatar_url, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (!rows.length) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'user not found' });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error('[auth/me]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// POST /api/auth/sign-out — clear auth cookies.
router.post('/sign-out', (_req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true });
});

export default router;
