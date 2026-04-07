export function adminAuth(req, res, next) {
  const key = req.header('X-Admin-Key');
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
