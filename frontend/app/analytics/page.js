'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState('24h');
  const [historicalData, setHistoricalData] = useState([]);
  const [serviceDistribution, setServiceDistribution] = useState([]);
  const [anomalyTrend, setAnomalyTrend] = useState([]);

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  const fetchAnalytics = () => {
    // Mock data - replace with actual API calls
    setHistoricalData([
      { time: '00:00', logs: 1200, errors: 45, warnings: 120 },
      { time: '04:00', logs: 800, errors: 20, warnings: 80 },
      { time: '08:00', logs: 2500, errors: 80, warnings: 200 },
      { time: '12:00', logs: 3200, errors: 120, warnings: 280 },
      { time: '16:00', logs: 2800, errors: 95, warnings: 220 },
      { time: '20:00', logs: 1800, errors: 60, warnings: 150 }
    ]);

    setServiceDistribution([
      { name: 'Auth Service', value: 3500, color: '#3B82F6' },
      { name: 'Payment Service', value: 2800, color: '#10B981' },
      { name: 'API Gateway', value: 4200, color: '#F59E0B' },
      { name: 'Database', value: 1500, color: '#EF4444' }
    ]);

    setAnomalyTrend([
      { time: '00:00', anomalies: 5, threshold: 10 },
      { time: '04:00', anomalies: 3, threshold: 10 },
      { time: '08:00', anomalies: 12, threshold: 10 },
      { time: '12:00', anomalies: 8, threshold: 10 },
      { time: '16:00', anomalies: 15, threshold: 10 },
      { time: '20:00', anomalies: 6, threshold: 10 }
    ]);
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

      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="text-xl font-bold mb-4">Log Volume Over Time</h2>
        <ResponsiveContainer width="100%" height={350}>
          <AreaChart data={historicalData}>
            <defs>
              <linearGradient id="colorLogs" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
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
            <Area type="monotone" dataKey="logs" stroke="#3B82F6" fillOpacity={1} fill="url(#colorLogs)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h2 className="text-xl font-bold mb-4">Errors & Warnings Trend</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={historicalData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" stroke="#9CA3AF" />
              <YAxis stroke="#9CA3AF" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
                labelStyle={{ color: '#F3F4F6' }}
              />
              <Legend />
              <Line type="monotone" dataKey="errors" stroke="#EF4444" strokeWidth={2} />
              <Line type="monotone" dataKey="warnings" stroke="#F59E0B" strokeWidth={2} />
            </LineChart>
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
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
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

      <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="text-xl font-bold mb-4">Anomaly Detection Trend</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={anomalyTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="time" stroke="#9CA3AF" />
            <YAxis stroke="#9CA3AF" />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
              labelStyle={{ color: '#F3F4F6' }}
            />
            <Legend />
            <Line type="monotone" dataKey="anomalies" stroke="#FBBF24" strokeWidth={2} name="Detected Anomalies" />
            <Line type="monotone" dataKey="threshold" stroke="#EF4444" strokeWidth={2} strokeDasharray="5 5" name="Threshold" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
