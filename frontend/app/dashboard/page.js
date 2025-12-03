'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalLogs: 0,
    errors: 0,
    anomalies: 0
  });
  const [errorData, setErrorData] = useState([]);
  const [latencyData, setLatencyData] = useState([]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    // TODO: Replace with actual API calls
    setStats({
      totalLogs: Math.floor(Math.random() * 10000),
      errors: Math.floor(Math.random() * 500),
      anomalies: Math.floor(Math.random() * 50)
    });

    setErrorData([
      { time: '10:00', errors: 12 },
      { time: '11:00', errors: 19 },
      { time: '12:00', errors: 8 },
      { time: '13:00', errors: 25 },
      { time: '14:00', errors: 15 },
      { time: '15:00', errors: 22 }
    ]);

    setLatencyData([
      { service: 'Auth', latency: 120 },
      { service: 'Payment', latency: 450 },
      { service: 'API', latency: 200 },
      { service: 'Database', latency: 80 }
    ]);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard Overview</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h3 className="text-gray-400 text-sm uppercase">Total Logs</h3>
          <p className="text-4xl font-bold mt-2">{stats.totalLogs.toLocaleString()}</p>
          <p className="text-green-500 text-sm mt-2">↑ 12% from last hour</p>
        </div>
        
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h3 className="text-gray-400 text-sm uppercase">Errors</h3>
          <p className="text-4xl font-bold mt-2 text-red-500">{stats.errors}</p>
          <p className="text-red-500 text-sm mt-2">↑ 8% from last hour</p>
        </div>
        
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h3 className="text-gray-400 text-sm uppercase">Anomalies</h3>
          <p className="text-4xl font-bold mt-2 text-yellow-500">{stats.anomalies}</p>
          <p className="text-yellow-500 text-sm mt-2">↓ 3% from last hour</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h2 className="text-xl font-bold mb-4">Errors Over Time</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={errorData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" stroke="#9CA3AF" />
              <YAxis stroke="#9CA3AF" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                labelStyle={{ color: '#F3F4F6' }}
              />
              <Legend />
              <Line type="monotone" dataKey="errors" stroke="#EF4444" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h2 className="text-xl font-bold mb-4">Average Latency by Service</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={latencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="service" stroke="#9CA3AF" />
              <YAxis stroke="#9CA3AF" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                labelStyle={{ color: '#F3F4F6' }}
              />
              <Legend />
              <Bar dataKey="latency" fill="#3B82F6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
