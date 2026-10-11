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
    try {
      // Always use dev-token-123 for now
      const token = 'dev-token-123';
      const apiUrl = 'http://localhost:8000';
      
      console.log('Fetching stats from:', apiUrl);
      console.log('Using token:', token);
      
      // Fetch stats
      const statsRes = await fetch(`${apiUrl}/api/logs/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!statsRes.ok) {
        throw new Error(`Stats API failed: ${statsRes.status}`);
      }
      
      const statsData = await statsRes.json();
      console.log('Stats data:', statsData);
      
      setStats({
        totalLogs: parseInt(statsData.total_logs) || 0,
        errors: parseInt(statsData.errors) || 0,
        anomalies: parseInt(statsData.anomalies) || 0
      });

      // Fetch errors over time
      const errorsRes = await fetch(`${apiUrl}/api/logs/errors-over-time`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (errorsRes.ok) {
        const errorsData = await errorsRes.json();
        console.log('Errors data:', errorsData);
        
        if (errorsData.data && errorsData.data.length > 0) {
          setErrorData(errorsData.data.map(d => ({
            time: new Date(d.time).toLocaleTimeString(),
            errors: parseInt(d.errors)
          })));
        }
      }

      // Fetch latency by service
      const latencyRes = await fetch(`${apiUrl}/api/logs/latency-by-service`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (latencyRes.ok) {
        const latencyData = await latencyRes.json();
        console.log('Latency data:', latencyData);
        
        if (latencyData.data && latencyData.data.length > 0) {
          setLatencyData(latencyData.data.map(d => ({
            service: d.service,
            latency: Math.round(parseFloat(d.latency))
          })));
        }
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
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
          <h2 className="text-xl font-bold mb-4">Average Latency by Service (Top 10)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={latencyData.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="service" 
                stroke="#9CA3AF"
                angle={-45}
                textAnchor="end"
                height={80}
                interval={0}
                tick={{ fontSize: 12 }}
              />
              <YAxis stroke="#9CA3AF" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                labelStyle={{ color: '#F3F4F6' }}
                cursor={{ fill: 'rgba(59, 130, 246, 0.1)' }}
              />
              <Legend />
              <Bar 
                dataKey="latency" 
                fill="#3B82F6" 
                radius={[4, 4, 0, 0]}
                activeBar={{ fill: '#60A5FA' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
