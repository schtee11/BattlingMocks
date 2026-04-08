import { useEffect, useState } from 'react';

const KEY = 'mds_user';
const listeners = new Set();

function read() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Write to storage and notify every useAuth subscriber across the tree.
function write(u) {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((fn) => {
    try { fn(u); } catch {}
  });
}

export function useAuth() {
  const [user, setUserState] = useState(read);

  useEffect(() => {
    // Subscribe this component to auth updates triggered from anywhere.
    listeners.add(setUserState);

    // Also stay in sync with localStorage changes from other tabs.
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
    signOut: () => write(null),
  };
}
