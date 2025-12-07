'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState('24h');
  const [stats, setStats] = useState({ totalLogs: 0, errors: 0, anomalies: 0 });
  const [errorTrend, setErrorTrend] = useState([]);
  const [serviceDistribution, setServiceDistribution] = useState([]);
  const [latencyData, setLatencyData] = useState([]);

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [timeRange]);

  const fetchAnalytics = async () => {
    try {
      const token = 'dev-token-123';
      const apiUrl = 'http://localhost:8000';

      // Fetch overall stats
      const statsRes = await fetch(`${apiUrl}/api/logs/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats({
          totalLogs: parseInt(statsData.total_logs) || 0,
          errors: parseInt(statsData.errors) || 0,
          anomalies: parseInt(statsData.anomalies) || 0
        });
      }

      // Fetch error trends
      const errorsRes = await fetch(`${apiUrl}/api/logs/errors-over-time`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (errorsRes.ok) {
        const errorsData = await errorsRes.json();
        if (errorsData.data && errorsData.data.length > 0) {
          setErrorTrend(errorsData.data.map(d => ({
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
        if (latencyData.data && latencyData.data.length > 0) {
          const services = latencyData.data.slice(0, 8).map(d => ({
            service: d.service,
            latency: Math.round(parseFloat(d.latency))
          }));
          setLatencyData(services);
          
          // Create service distribution from latency data
          const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
          setServiceDistribution(services.map((s, i) => ({
            name: s.service,
            value: s.latency,
            color: colors[i % colors.length]
          })));
        }
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white"
        >
          <option value="1h">Last Hour</option>
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h3 className="text-gray-400 text-sm uppercase">Total Logs</h3>
          <p className="text-4xl font-bold mt-2">{stats.totalLogs.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h3 className="text-gray-400 text-sm uppercase">Total Errors</h3>
          <p className="text-4xl font-bold mt-2 text-red-500">{stats.errors}</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h3 className="text-gray-400 text-sm uppercase">Anomalies Detected</h3>
          <p className="text-4xl font-bold mt-2 text-yellow-500">{stats.anomalies}</p>
        </div>
      </div>

      {/* Error Trend */}
      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="text-xl font-bold mb-4">Error Trend Over Time</h2>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={errorTrend}>
            <defs>
              <linearGradient id="colorErrors" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#EF4444" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="time" stroke="#9CA3AF" />
            <YAxis stroke="#9CA3AF" />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
              labelStyle={{ color: '#F3F4F6' }}
            />
            <Legend />
            <Area 
              type="monotone" 
              dataKey="errors" 
              stroke="#EF4444" 
              fillOpacity={1} 
              fill="url(#colorErrors)"
              name="Errors"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Service Latency and Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h2 className="text-xl font-bold mb-4">Latency by Service (Top 8)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={latencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="service" 
                stroke="#9CA3AF"
                angle={-45}
                textAnchor="end"
                height={80}
                interval={0}
                tick={{ fontSize: 11 }}
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
                name="Avg Latency (ms)"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h2 className="text-xl font-bold mb-4">Service Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={serviceDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name.split('-')[0]}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={90}
                fill="#8884d8"
                dataKey="value"
              >
                {serviceDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="text-xl font-bold mb-4">Key Metrics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-gray-400 text-sm">Error Rate</p>
            <p className="text-2xl font-bold text-red-500">
              {stats.totalLogs > 0 ? ((stats.errors / stats.totalLogs) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm">Anomaly Rate</p>
            <p className="text-2xl font-bold text-yellow-500">
              {stats.totalLogs > 0 ? ((stats.anomalies / stats.totalLogs) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm">Services Monitored</p>
            <p className="text-2xl font-bold text-blue-500">{serviceDistribution.length}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm">ML Detection Active</p>
            <p className="text-2xl font-bold text-green-500">✓</p>
          </div>
        </div>
      </div>
    </div>
  );
}
