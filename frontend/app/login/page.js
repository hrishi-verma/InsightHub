'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, errorMessage } from '../../lib/api.js';
import { safeNextPath } from '../../lib/security.js';
import { useAuth } from '../../components/AuthProvider.js';

function nextPath() {
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}

export default function LoginPage() {
  const router = useRouter();
  const { signedIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Skip the form.
  useEffect(() => {
    let cancelled = false;
    api.me().then(() => {
      if (!cancelled) {
        signedIn();
        router.replace(nextPath());
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [router, signedIn]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await api.login(email.trim(), password);
      setPassword('');
      signedIn();
      router.replace(nextPath());
    } catch (err) {
      setPassword('');
      // Same message for unknown email and wrong password (contract §4).
      setError(err instanceof ApiError && err.status === 401 ? 'Incorrect email or password.' : errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="mb-2 text-center text-3xl font-bold">InsightHub</h1>
        <p className="mb-8 text-center text-gray-300">Sign in to your account</p>

        {error && (
          <div role="alert" className="mb-4 rounded border border-red-500 bg-red-500/10 px-4 py-3 text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input py-3"
            />
          </div>

          <div>
            <label htmlFor="password" className="label">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input py-3"
            />
          </div>

          <button type="submit" disabled={submitting} className="btn-primary w-full py-3">
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {process.env.NEXT_PUBLIC_USE_MOCKS === 'true' && (
          <p className="mt-6 text-center text-sm text-yellow-200">
            Mock mode: any email with a 12+ character password signs in. Emails starting with
            &quot;viewer&quot; get the viewer role.
          </p>
        )}
      </div>
    </div>
  );
}
