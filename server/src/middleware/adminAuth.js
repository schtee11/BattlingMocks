import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './requireAuth.js';

// Admin authentication middleware. Supports two mechanisms:
//
// 1. JWT cookie — the authenticated user must have is_admin=TRUE in the DB.
//    Preferred for browser-based admin sessions.
//
// 2. X-Admin-Key header — must match process.env.ADMIN_KEY. Kept as a
//    fallback for programmatic/CI access and backward compatibility.
//
// Either mechanism is sufficient; if both are present the key takes priority
// (cheaper — no DB lookup).

export async function adminAuth(req, res, next) {
  // Path 1: legacy admin key (fast, no DB lookup)
  const headerKey = req.header('X-Admin-Key');
  if (headerKey && process.env.ADMIN_KEY && headerKey === process.env.ADMIN_KEY) {
    return next();
  }

  // Path 2: JWT cookie with is_admin check
  const secret = process.env.JWT_SECRET;
  if (secret) {
    const token = req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE];
    if (token) {
      try {
        const payload = jwt.verify(token, secret);
        if (payload?.sub) {
          const { rows } = await pool.query(
            'SELECT is_admin FROM users WHERE id = $1',
            [payload.sub]
          );
          if (rows[0]?.is_admin === true) {
            req.userId = payload.sub;
            return next();
          }
        }
      } catch {
        // Token invalid or expired — fall through to 401.
      }
    }
  }

  return res.status(401).json({ error: 'unauthorized' });
}
