'use client';

import { usePathname } from 'next/navigation';
import { AuthProvider, useAuth } from './AuthProvider.js';
import Navbar from './Navbar.js';
import { ErrorState, Loading } from './ui.js';

function MockBanner() {
  if (process.env.NEXT_PUBLIC_USE_MOCKS !== 'true') return null;
  return (
    <div className="bg-yellow-500 px-4 py-1 text-center text-sm font-semibold text-gray-900">
      Mock mode: fake data, no real API calls (NEXT_PUBLIC_USE_MOCKS=true)
    </div>
  );
}

function Guarded({ children }) {
  const { status, error, reload, projects } = useAuth();

  if (status === 'error') {
    return (
      <main className="container mx-auto px-4 py-8 sm:px-6">
        <ErrorState error={error} onRetry={reload} title="Could not check your session" />
      </main>
    );
  }
  // Fail closed: nothing protected renders until the API confirms the session.
  if (status !== 'ready') {
    return (
      <main className="container mx-auto px-4 py-8 sm:px-6">
        <Loading label="Checking your session…" />
      </main>
    );
  }
  return (
    <>
      <Navbar />
      <main id="main" className="container mx-auto px-4 py-8 sm:px-6">
        {projects.length === 0
          ? <p className="card p-6 text-gray-300">You don&apos;t have access to any projects yet.</p>
          : children}
      </main>
    </>
  );
}

function Shell({ children }) {
  const pathname = usePathname();
  if (pathname === '/login') return <main>{children}</main>;
  return <Guarded>{children}</Guarded>;
}

export default function AppShell({ children }) {
  return (
    <AuthProvider>
      <MockBanner />
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
