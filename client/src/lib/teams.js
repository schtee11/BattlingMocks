// Team logo URLs from ESPN's CDN. These are stable public URLs used by
// ESPN's own apps. Most of our team abbreviations match ESPN's directly;
// the ones that don't get remapped below.
const ESPN_ABBR_MAP = {
  WAS: 'wsh', // Washington Commanders
};

export function teamLogoUrl(abbr) {
  if (!abbr) return null;
  const upper = String(abbr).toUpperCase();
  const key = ESPN_ABBR_MAP[upper] || upper.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${key}.png`;
}
