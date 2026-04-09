import { Router } from 'express';

const router = Router();

// Narrowly-scoped image proxy. Only used by the team-mock share/export flow
// to capture team logos and prospect headshots into a PNG — ESPN CDN doesn't
// send CORS headers, so html-to-image can't read them directly from the
// client's canvas. Whitelisted to specific hostnames so this can't be used
// as an open SSRF vector.
const ALLOWED_HOSTS = new Set([
  'a.espncdn.com',
  'a1.espncdn.com',
  'a2.espncdn.com',
  'a3.espncdn.com',
  'a4.espncdn.com',
]);

router.get('/', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url query param required' });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }
  if (parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'https only' });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return res.status(403).json({ error: 'host not allowed', host: parsed.hostname });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'MockDraftShowdown/1.0' },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
    }
    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await upstream.arrayBuffer());
    // Explicit CORS header so html-to-image can read the pixels into canvas.
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(buf);
  } catch (e) {
    console.error('[image-proxy]', e);
    res.status(502).json({ error: 'upstream fetch failed' });
  }
});

export default router;
