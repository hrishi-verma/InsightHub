'use client';

import { useState, useEffect } from 'react';
import LogStream from '../components/LogStream';
import Dashboard from '../components/Dashboard';

export default function Home() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <nav className="bg-gray-800 p-4">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold">InsightHub</h1>
          <div className="space-x-4">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2 rounded ${activeTab === 'dashboard' ? 'bg-blue-600' : 'bg-gray-700'}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-4 py-2 rounded ${activeTab === 'logs' ? 'bg-blue-600' : 'bg-gray-700'}`}
            >
              Live Logs
            </button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto p-6">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'logs' && <LogStream />}
      </main>
    </div>
  );
}
