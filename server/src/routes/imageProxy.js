import { Router } from 'express';

const router = Router();

// Narrowly-scoped image proxy. Used by the share/export flow (to capture
// team logos and prospect headshots into a PNG — ESPN CDN doesn't send
// CORS headers, so html-to-image can't read them directly from the client's
// canvas) AND by mobile display (ESPN CDN serves placeholders to iOS Safari
// with a no-referrer policy). Restricted to ESPN's CDN domain so this can't
// be used as an open SSRF vector. Any *.espncdn.com subdomain is allowed
// because ESPN sends headshots from multiple hosts (a/a1-a4/secure/images/
// combiner images are hosted across several) and the client-side regex in
// playerImageUrl matches the whole domain — keeping the server stricter
// than the client silently 403s anything served from a subdomain we
// happened not to list.
function isAllowedEspnHost(host) {
  return typeof host === 'string' && /(^|\.)espncdn\.com$/i.test(host);
}

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
  if (!isAllowedEspnHost(parsed.hostname)) {
    return res.status(403).json({ error: 'host not allowed', host: parsed.hostname });
  }

  try {
    // Send real browser headers. ESPN CDN serves different content (a
    // generic placeholder silhouette) when the User-Agent looks bot-like,
    // which is why the team logo was showing as a player photo in the
    // captured export. A standard Chrome UA + Referer fixes it.
    const upstream = await fetch(parsed.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept':
          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.espn.com/',
      },
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
