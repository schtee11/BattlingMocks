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

// Cookie options. In production, API requests are proxied through Netlify
// (_redirects rewrite) so cookies are same-origin — SameSite=Lax is correct
// and avoids the cross-site cookie restrictions that mobile browsers enforce
// (Safari ITP, private browsing, etc.). Secure is set in production because
// the proxy connection is HTTPS end-to-end.
function cookieOpts(maxAgeMs) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
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

// Middleware: require a valid access token. Sets req.userId.
// If the access token is expired but a valid refresh token exists, silently
// refreshes the access token and sets a new cookie.
export function requireAuth(req, res, next) {
  const accessToken = req.cookies?.[ACCESS_COOKIE];
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
  const accessToken = req.cookies?.[ACCESS_COOKIE];
  if (accessToken) {
    const payload = verifyToken(accessToken);
    if (payload?.sub) {
      req.userId = payload.sub;
    }
  }
  next();
}
