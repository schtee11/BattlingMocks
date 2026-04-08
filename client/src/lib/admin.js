// Allowed admin display names. Configurable via VITE_ADMIN_NAMES env var
// (comma-separated). Defaults to the repo owner for sanity.
const raw = import.meta.env.VITE_ADMIN_NAMES || 'schtee-8923';
const ADMIN_NAMES = raw
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(user) {
  if (!user?.display_name) return false;
  return ADMIN_NAMES.includes(user.display_name.trim().toLowerCase());
}
