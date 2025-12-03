'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // TODO: Replace with actual API call
    if (formData.email && formData.password) {
      // Mock JWT token
      localStorage.setItem('token', 'mock-jwt-token');
      router.push('/dashboard');
    } else {
      setError('Please enter email and password');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 p-8 rounded-lg border border-gray-700 w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-6">InsightHub</h1>
        <p className="text-gray-400 text-center mb-8">Sign in to your account</p>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-500 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-2">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-3 focus:outline-none focus:border-blue-500"
              placeholder="admin@insighthub.com"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-3 focus:outline-none focus:border-blue-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-3 rounded font-semibold transition"
          >
            Sign In
          </button>
        </form>

        <p className="text-gray-400 text-sm text-center mt-6">
          Demo credentials: admin@insighthub.com / admin123
        </p>
      </div>
    </div>
  );
}
