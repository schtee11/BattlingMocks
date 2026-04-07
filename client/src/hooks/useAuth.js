import { useState } from 'react';

const KEY = 'mds_user';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [user, setUserState] = useState(read);

  function setUser(u) {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
    setUserState(u);
  }

  return { user, setUser, signOut: () => setUser(null) };
}
