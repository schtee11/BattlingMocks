import { useEffect, useState } from 'react';
import { api, setAccessToken } from '../lib/api.js';

const KEY = 'mds_user';
const listeners = new Set();
let hydrated = false;

function readLocal() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Write to localStorage and notify every useAuth subscriber across the tree.
function write(u) {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((fn) => {
    try { fn(u); } catch {}
  });
}

// Hydrate from the server-side JWT cookie. Called once on app startup.
// Falls back to localStorage if the server call fails (offline, no cookie).
async function hydrateFromServer() {
  if (hydrated) return;
  hydrated = true;
  try {
    const user = await api.getMe();
    write(user);
  } catch (err) {
    // 401 = server is reachable but the session is invalid or missing
    // (e.g. user logged in before JWT cookies were introduced). Clear the
    // stale localStorage entry so they're prompted to sign in again.
    if (err?.status === 401) {
      write(null);
    }
    // For network errors or 5xx keep whatever localStorage had (offline /
    // transient fault) so the user isn't unnecessarily logged out.
  }
}

export function useAuth() {
  const [user, setUserState] = useState(readLocal);

  useEffect(() => {
    // Subscribe this component to auth updates triggered from anywhere.
    listeners.add(setUserState);

    // Hydrate from server cookie on first mount.
    hydrateFromServer();

    // Stay in sync with localStorage changes from other tabs.
    const onStorage = (e) => {
      if (e.key !== KEY) return;
      try {
        setUserState(e.newValue ? JSON.parse(e.newValue) : null);
      } catch {
        setUserState(null);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      listeners.delete(setUserState);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return {
    user,
    setUser: write,
    signOut: async () => {
      try { await api.signOut(); } catch {}
      setAccessToken(null);
      write(null);
    },
  };
}
