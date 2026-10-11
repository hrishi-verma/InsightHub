'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider.js';
import { errorMessage } from '../lib/api.js';

const NAV_ITEMS = [
  { name: 'Overview', path: '/dashboard' },
  { name: 'Issues', path: '/issues' },
  { name: 'Alerts', path: '/alerts' },
];

export default function Navbar() {
  const pathname = usePathname();
  const { user, projects, project, setProject, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [logoutError, setLogoutError] = useState(null);

  const handleLogout = async () => {
    setBusy(true);
    setLogoutError(null);
    try {
      await logout();
    } catch (e) {
      setLogoutError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <nav className="border-b border-gray-700 bg-gray-800" aria-label="Main">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="focus-ring rounded text-xl font-bold text-blue-400">
          InsightHub
        </Link>

        <ul className="flex flex-wrap gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.path || pathname.startsWith(`${item.path}/`);
            return (
              <li key={item.path}>
                <Link
                  href={item.path}
                  aria-current={active ? 'page' : undefined}
                  className={`focus-ring block rounded px-3 py-2 text-sm transition ${
                    active ? 'bg-blue-600 text-white' : 'text-gray-200 hover:bg-gray-700'
                  }`}
                >
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <span>Project</span>
            <select
              className="input w-auto py-1.5"
              value={project ?? ''}
              onChange={(e) => setProject(e.target.value)}
              disabled={projects.length < 2}
            >
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name}</option>
              ))}
            </select>
          </label>
          {user && (
            <span className="hidden text-sm text-gray-300 md:inline" title={user.email}>
              {user.email} <span className="text-gray-400">({user.role})</span>
            </span>
          )}
          <button type="button" onClick={handleLogout} disabled={busy} className="btn-secondary">
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
      {logoutError && (
        <p role="alert" className="container mx-auto px-4 pb-3 text-sm text-red-300 sm:px-6">
          Sign out failed: {logoutError}
        </p>
      )}
    </nav>
  );
}
