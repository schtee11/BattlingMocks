import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET;

// Cookie names. Access token is short-lived; refresh token is long-lived.
export const ACCESS_COOKIE = 'mds_access';
export const REFRESH_COOKIE = 'mds_refresh';

// Token lifetimes
export const ACCESS_TTL = '15m';
export const REFRESH_TTL = '7d';

// Mint a signed JWT for the given user id.
export function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, SECRET(), { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(userId) {
  return jwt.sign({ sub: userId, type: 'refresh' }, SECRET(), { expiresIn: REFRESH_TTL });
}

// Cookie options. The frontend (Netlify) and API (Railway) are on different
// origins, so we need SameSite=None; Secure in production to allow cookies
// to be sent with cross-origin fetch requests (credentials: 'include').
// In development (localhost), SameSite=Lax is fine because both services
// share the same host, and Secure is omitted since localhost uses HTTP.
function cookieOpts(maxAgeMs) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

// Set both access and refresh cookies on the response.
export function setAuthCookies(res, userId) {
  const access = signAccessToken(userId);
  const refresh = signRefreshToken(userId);
  res.cookie(ACCESS_COOKIE, access, cookieOpts(15 * 60 * 1000));
  res.cookie(REFRESH_COOKIE, refresh, cookieOpts(7 * 24 * 60 * 60 * 1000));
  return { access, refresh };
}

// Clear auth cookies (sign-out).
export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
}

// Verify a token string and return the payload (or null).
function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET());
  } catch {
    return null;
  }
}

// Extract a Bearer token from the Authorization header (if present).
function bearerToken(req) {
  const h = req.get('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

// Middleware: require a valid access token. Sets req.userId.
// Checks cookies first, then falls back to an Authorization: Bearer header
// so mobile browsers that block cross-origin cookies (Safari ITP, private
// browsing) can still authenticate via a token stored in localStorage.
// If the access token is expired but a valid refresh token exists, silently
// refreshes the access token and sets a new cookie.
export function requireAuth(req, res, next) {
  const accessToken = req.cookies?.[ACCESS_COOKIE] || bearerToken(req);
  const refreshToken = req.cookies?.[REFRESH_COOKIE];

  // Try the access token first.
  let payload = accessToken ? verifyToken(accessToken) : null;
  if (payload?.sub) {
    req.userId = payload.sub;
    return next();
  }

  // Access token expired or missing — try the refresh token.
  if (refreshToken) {
    payload = verifyToken(refreshToken);
    if (payload?.sub && payload?.type === 'refresh') {
      req.userId = payload.sub;
      // Mint a fresh access token so the next request doesn't need refresh.
      const newAccess = signAccessToken(payload.sub);
      res.cookie(ACCESS_COOKIE, newAccess, cookieOpts(15 * 60 * 1000));
      return next();
    }
  }

  return res.status(401).json({ error: 'authentication required' });
}

// Middleware: optional auth. Populates req.userId if a valid token exists,
// but does not reject unauthenticated requests.
export function optionalAuth(req, _res, next) {
  const accessToken = req.cookies?.[ACCESS_COOKIE] || bearerToken(req);
  if (accessToken) {
    const payload = verifyToken(accessToken);
    if (payload?.sub) {
      req.userId = payload.sub;
    }
  }
  next();
}
