#!/usr/bin/env node
// Post-build SEO prerender.
//
// Why: the site is a Vite SPA. First response from Netlify is the same
// index.html for every route, which means non-JS crawlers (Twitter,
// Facebook, LinkedIn, Slack, Discord, Bing, Pinterest, etc.) see the
// HOMEPAGE meta tags no matter what URL they fetch. That kills rich
// social previews and hurts search indexing.
//
// This script takes the built dist/index.html and, for each public route,
// writes dist/<route>/index.html with route-specific:
//   - <title>
//   - <meta name="description">
//   - <meta property="og:title" / og:description / og:url>
//   - <meta name="twitter:title" / twitter:description>
//   - <link rel="canonical">
//   - a BreadcrumbList JSON-LD block (appended for non-root routes)
//   - a <noscript> SEO fallback block inside #root so crawlers without
//     JS execution see real, keyword-rich content.
//
// Netlify serves existing static files before applying the SPA catch-all
// redirect, so /draft will resolve to /draft/index.html automatically.
// Client-side React Router takes over after hydration.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const ORIGIN = 'https://mockdraftshowdown.com';

// Route-to-SEO config. Every route indexed in the sitemap should appear
// here. Keep the keyword-targeted titles in sync with client/src/pages
// usePageMeta() calls; this config wins for non-JS crawlers, and the
// hook wins for JS-rendered users.
const ROUTES = [
  {
    path: '/',
    title: 'NFL Mock Draft Simulator 2026 · MockDraft Showdown',
    description:
      'Free NFL Mock Draft Simulator for the 2026 NFL Draft. Build a predictive Round 1 mock, run a full 7-round team mock draft with trades, and score live on draft night against the real picks.',
    h1: 'Free NFL Mock Draft Simulator — 2026 NFL Draft',
    body:
      "MockDraft Showdown is a free NFL Mock Draft Simulator for the 2026 NFL Draft. Build a 32-pick predictive Round 1 mock and score live against the real picks on draft night, or GM any NFL team through a full 7-round mock draft with trades, a fairness meter, and a post-draft grade. No paywall, unlimited mocks.",
    breadcrumbs: null,
  },
  {
    path: '/draft',
    title: '2026 NFL Mock Draft Simulator — Predictive Round 1 · MockDraft Showdown',
    description:
      'Free 2026 NFL mock draft simulator. Build a 32-pick predictive Round 1 mock, mark confidence picks for a 1.5× multiplier, and score live against the real picks on draft night.',
    h1: '2026 NFL Mock Draft — Predictive Round 1',
    body:
      'Build your 2026 NFL mock draft in the predictive Round 1 simulator. Drag prospects into all 32 first-round slots, mark up to three confidence picks for a 1.5× scoring multiplier, and lock your picks before the real NFL Draft starts. On draft night every pick is graded in real time and your total climbs the public leaderboard.',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Predictive Mock Draft', path: '/draft' },
    ],
  },
  {
    path: '/team-mock',
    title: '7-Round NFL Mock Draft Simulator with Trades — Team Mock · MockDraft Showdown',
    description:
      'Free 7-round NFL mock draft simulator. GM any NFL team through all 7 rounds of the 2026 Draft, trade up or down with a fairness meter, and earn a post-draft grade on value, need fit, and league ranking.',
    h1: '7-Round NFL Mock Draft Simulator with Trades',
    body:
      'Run a full 7-round NFL mock draft as any team. The CPU drafts on a best-player-available plus team-needs engine, you can propose trades up or down at any pick, and a Rich Hill trade value chart plus fairness meter score every offer. When the draft ends you get a full grade on pick value, positional fit, and league-wide ranking. Unlimited saves, no paywall.',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Team Mock Draft', path: '/team-mock' },
    ],
  },
  {
    path: '/leaderboard',
    title: '2026 NFL Mock Draft Leaderboard — Live Rankings · MockDraft Showdown',
    description:
      'Live leaderboard for every 2026 NFL Mock Draft Simulator entry. See top scouts, exact-match rates, and percentile rank updating in real time on draft night.',
    h1: '2026 NFL Mock Draft Leaderboard',
    body:
      'The public leaderboard for the 2026 NFL Mock Draft Simulator. Rankings update live as each actual pick is announced on draft night. See top scouts by total score, exact-match rate, and percentile rank among all submitted mocks.',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Leaderboard', path: '/leaderboard' },
    ],
  },
  {
    path: '/live',
    title: '2026 NFL Draft Live Tracker — Real-Time Pick Scoring · MockDraft Showdown',
    description:
      'Watch the 2026 NFL Draft live with your mock draft predictions scoring in real time. Side-by-side actual picks vs. your picks, updating the moment each team is on the clock.',
    h1: '2026 NFL Draft — Live Pick Tracker',
    body:
      'Follow the 2026 NFL Draft live. As each team goes on the clock, the actual pick is announced and your mock draft is scored instantly. Side-by-side panels show the real Round 1 board next to your predictions, color-coded by match state.',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Live Draft', path: '/live' },
    ],
  },
  {
    path: '/my-board',
    title: 'My NFL Draft Big Board — 2026 Prospect Rankings · MockDraft Showdown',
    description:
      'Build your personal 2026 NFL Draft big board. Rank prospects, save your rankings, and use them in the mock draft simulator and team mock modes.',
    h1: 'Build Your 2026 NFL Draft Big Board',
    body:
      'Rank every 2026 NFL Draft prospect on your personal big board. Drag players into your preferred order, save your rankings to your account, and apply them inside the mock draft simulator so CPU teams respect your board.',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'My Big Board', path: '/my-board' },
    ],
  },
  {
    path: '/my-mock',
    title: 'My 2026 NFL Mock Draft — Pick-by-Pick Scoring · MockDraft Showdown',
    description:
      'Your submitted 2026 NFL mock draft with pick-by-pick scoring, total points, and live refresh during draft night. Share your card and track your rank.',
    h1: 'My 2026 NFL Mock Draft',
    body:
      'View your submitted 2026 NFL mock draft. Every pick is scored against the real draft results with a live color-coded breakdown: exact match, right player wrong team, or in-Round-1 credit. Share your printable card and watch your rank climb the leaderboard.',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'My Mock', path: '/my-mock' },
    ],
  },
  {
    path: '/guide',
    title: 'How to Do a 2026 NFL Mock Draft — Complete Guide · MockDraft Showdown',
    description:
      "A complete guide to the 2026 NFL Mock Draft: what a mock draft is, how predictive and team mock modes differ, scoring rules, trade strategy, and tips to build a smarter NFL mock draft.",
    h1: 'How to Do a 2026 NFL Mock Draft',
    body:
      "A complete guide to doing a 2026 NFL Mock Draft. Learn the difference between predictive mock drafts (predict what each team actually does) and team mock drafts (GM a team through all 7 rounds), how live draft-night scoring works, how to use confidence picks for a 1.5× multiplier, and trade strategy with the Rich Hill value chart.",
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Mock Draft Guide', path: '/guide' },
    ],
  },
  {
    path: '/about',
    title: 'About MockDraft Showdown — Free NFL Mock Draft Simulator',
    description:
      'About MockDraft Showdown: a free NFL mock draft simulator for the 2026 NFL Draft. Our scoring methodology, trade logic, and why the platform will always be free.',
    h1: 'About MockDraft Showdown',
    body:
      "MockDraft Showdown is a free NFL Mock Draft Simulator built around a live predictive contest. No paywall, no accounts required to play, no data sold. Our scoring tiers (Exact, Team, In-Round-1) reward accuracy at every level, and our CPU teams use a best-player-available plus team-needs engine with a Rich Hill trade value chart for realistic drafts.",
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'About', path: '/about' },
    ],
  },
  {
    path: '/join',
    title: 'Sign In — Join the 2026 NFL Mock Draft Simulator · MockDraft Showdown',
    description:
      'Create a free account to compete in the 2026 NFL Mock Draft Simulator. Sign in with Discord or Google to submit your picks and climb the live leaderboard.',
    h1: 'Join the 2026 NFL Mock Draft',
    body:
      'Sign in with Discord or Google to submit your 2026 NFL mock draft and compete on the public leaderboard. Accounts are free and you can delete yours anytime from settings.',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Sign In', path: '/join' },
    ],
  },
];

function replaceTag(html, regex, replacement) {
  if (!regex.test(html)) {
    console.warn(`[seo-prerender] warning: pattern ${regex} not found`);
    return html;
  }
  return html.replace(regex, replacement);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildBreadcrumbJsonLd(breadcrumbs) {
  if (!breadcrumbs || breadcrumbs.length === 0) return '';
  const itemListElement = breadcrumbs.map((b, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: b.name,
    item: `${ORIGIN}${b.path}`,
  }));
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement,
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function buildSeoFallbackBlock({ h1, body, breadcrumbs }) {
  // Visible crawler content. Hidden from sighted users once React hydrates
  // (it overwrites #root's children). Kept accessible and keyword-dense.
  const crumbs = (breadcrumbs || [])
    .map((b, i, arr) => {
      const isLast = i === arr.length - 1;
      return isLast
        ? `<span aria-current="page">${escapeHtml(b.name)}</span>`
        : `<a href="${escapeAttr(b.path)}">${escapeHtml(b.name)}</a>`;
    })
    .join(' › ');
  return `
    <div class="seo-fallback" style="max-width:72ch;margin:0 auto;padding:2rem 1rem;color:#e6ebf5;font-family:system-ui,sans-serif;line-height:1.6">
      ${crumbs ? `<nav aria-label="Breadcrumb" style="font-size:.85rem;opacity:.7;margin-bottom:1rem">${crumbs}</nav>` : ''}
      <h1 style="font-size:1.75rem;margin:0 0 1rem">${escapeHtml(h1)}</h1>
      <p>${escapeHtml(body)}</p>
      <p><a href="/draft">Start a Predictive Mock Draft</a> · <a href="/team-mock">Team Mock Draft Simulator</a> · <a href="/leaderboard">Leaderboard</a> · <a href="/guide">Mock Draft Guide</a></p>
    </div>
  `.trim();
}

function prerender(route, template) {
  const url = `${ORIGIN}${route.path === '/' ? '/' : route.path}`;
  let html = template;

  html = replaceTag(html, /<title>[^<]*<\/title>/i, `<title>${escapeHtml(route.title)}</title>`);
  html = replaceTag(
    html,
    /<meta name="description"[^>]*>/i,
    `<meta name="description" content="${escapeAttr(route.description)}" />`,
  );
  html = replaceTag(
    html,
    /<link rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${escapeAttr(url)}" />`,
  );
  html = replaceTag(
    html,
    /<meta property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${escapeAttr(route.title)}" />`,
  );
  html = replaceTag(
    html,
    /<meta property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${escapeAttr(route.description)}" />`,
  );
  html = replaceTag(
    html,
    /<meta property="og:url"[^>]*>/i,
    `<meta property="og:url" content="${escapeAttr(url)}" />`,
  );
  html = replaceTag(
    html,
    /<meta name="twitter:title"[^>]*>/i,
    `<meta name="twitter:title" content="${escapeAttr(route.title)}" />`,
  );
  html = replaceTag(
    html,
    /<meta name="twitter:description"[^>]*>/i,
    `<meta name="twitter:description" content="${escapeAttr(route.description)}" />`,
  );

  // BreadcrumbList JSON-LD injected just before </head>
  const breadcrumbLd = buildBreadcrumbJsonLd(route.breadcrumbs);
  if (breadcrumbLd) {
    html = html.replace('</head>', `${breadcrumbLd}\n  </head>`);
  }

  // SEO fallback inside #root — React will replace this on hydrate
  const fallback = buildSeoFallbackBlock(route);
  html = html.replace('<div id="root"></div>', `<div id="root">${fallback}</div>`);

  return html;
}

function writeRoute(route, html) {
  const outDir = route.path === '/' ? DIST : resolve(DIST, route.path.replace(/^\//, ''));
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, 'index.html');
  writeFileSync(outFile, html, 'utf8');
  return outFile.replace(DIST, 'dist');
}

function main() {
  const templatePath = resolve(DIST, 'index.html');
  const template = readFileSync(templatePath, 'utf8');

  let rootOutput = '';
  for (const route of ROUTES) {
    const html = prerender(route, template);
    if (route.path === '/') {
      rootOutput = html;
      continue;
    }
    const written = writeRoute(route, html);
    console.log(`[seo-prerender] wrote ${written}`);
  }
  // Root overwrites the vite-produced dist/index.html so the SPA fallback
  // (and any unmatched route) still gets the homepage SEO block.
  writeFileSync(templatePath, rootOutput, 'utf8');
  console.log(`[seo-prerender] rewrote dist/index.html (root)`);
  console.log(`[seo-prerender] prerendered ${ROUTES.length} routes`);
}

main();
