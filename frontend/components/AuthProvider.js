'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, setUnauthorizedHandler } from '../lib/api.js';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function loginUrl() {
  const here = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(here)}`;
}

// Holds the signed-in user and project list. Nothing is rendered for a protected page
// until GET /auth/me succeeds; any 401 sends the user to /login.
export function AuthProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState('loading'); // loading | ready | anon | error
  const [user, setUserState] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const loadId = useRef(0);

  const isLoginPage = pathname === '/login';

  const goToLogin = useCallback(() => {
    setUserState(null);
    setStatus('anon');
    if (window.location.pathname !== '/login') router.replace(loginUrl());
  }, [router]);

  useEffect(() => {
    setUnauthorizedHandler(goToLogin);
    return () => setUnauthorizedHandler(null);
  }, [goToLogin]);

  const loadSession = useCallback(async () => {
    const id = ++loadId.current;
    setStatus('loading');
    setError(null);
    try {
      const me = await api.me();
      const { projects: list } = await api.projects();
      if (id !== loadId.current) return;
      const safeList = Array.isArray(list) ? list : [];
      setUserState(me.user);
      setProjects(safeList);
      setProject((cur) => (cur && safeList.some((p) => p.slug === cur) ? cur : safeList[0]?.slug ?? null));
      setStatus('ready');
    } catch (e) {
      if (id !== loadId.current) return;
      if (e instanceof ApiError && e.status === 401) {
        goToLogin();
      } else {
        setError(e);
        setStatus('error');
      }
    }
  }, [goToLogin]);

  useEffect(() => {
    if (isLoginPage) return;
    if (status === 'ready' || status === 'error') return;
    loadSession();
    // Re-check only when entering a protected page without a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoginPage, pathname]);

  // Called by the login page after a successful POST /auth/login.
  const signedIn = useCallback(() => {
    setStatus('loading');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (e) {
      // 401 means the session is already gone; anything else means the cookie may still be valid.
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
    loadId.current++;
    setUserState(null);
    setProjects([]);
    setProject(null);
    setStatus('anon');
    router.replace('/login');
  }, [router]);

  const value = useMemo(() => ({
    status, user, projects, project, setProject, error, isAdmin: user?.role === 'admin',
    reload: loadSession, signedIn, logout,
  }), [status, user, projects, project, error, loadSession, signedIn, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
