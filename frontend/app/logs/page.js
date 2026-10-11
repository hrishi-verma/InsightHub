'use client';

import { useState, useEffect, useRef } from 'react';

export default function LiveLogsPage() {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState({
    service: '',
    level: '',
    keyword: ''
  });
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef(null);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchLogs = async () => {
    try {
      const token = 'dev-token-123';
      const apiUrl = 'http://localhost:8000';
      
      const response = await fetch(`${apiUrl}/api/logs?limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        throw new Error(`Logs API failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.logs && data.logs.length > 0) {
        setLogs(data.logs.map(log => ({
          id: log.log_id,
          service: log.service,
          level: log.level,
          message: log.message,
          timestamp: log.created_at,
          latency_ms: log.latency_ms || 0
        })));
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    }
  };

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const generateMockLog = () => {
    const services = ['auth-service', 'payment-service', 'api-gateway', 'database'];
    const levels = ['INFO', 'WARN', 'ERROR', 'DEBUG'];
    const messages = [
      'User logged in successfully',
      'Payment processed',
      'Database connection timeout',
      'API request received',
      'Cache miss',
      'Authentication failed'
    ];

    return {
      id: Date.now() + Math.random(),
      service: services[Math.floor(Math.random() * services.length)],
      level: levels[Math.floor(Math.random() * levels.length)],
      message: messages[Math.floor(Math.random() * messages.length)],
      timestamp: new Date().toISOString(),
      latency_ms: Math.floor(Math.random() * 1000)
    };
  };

  const getLevelColor = (level) => {
    switch (level) {
      case 'ERROR': return 'text-red-500 bg-red-500/10 border-red-500';
      case 'WARN': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500';
      case 'INFO': return 'text-blue-500 bg-blue-500/10 border-blue-500';
      case 'DEBUG': return 'text-gray-500 bg-gray-500/10 border-gray-500';
      default: return 'text-gray-400 bg-gray-400/10 border-gray-400';
    }
  };

  const filteredLogs = logs.filter(log => {
    if (filters.service && !log.service.includes(filters.service)) return false;
    if (filters.level && log.level !== filters.level) return false;
    if (filters.keyword && !log.message.toLowerCase().includes(filters.keyword.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Live Log Stream</h1>
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm">Auto-scroll</span>
        </label>
      </div>

      <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="Filter by service..."
            value={filters.service}
            onChange={(e) => setFilters({ ...filters, service: e.target.value })}
            className="bg-gray-900 border border-gray-700 rounded px-4 py-2 text-white"
          />
          <select
            value={filters.level}
            onChange={(e) => setFilters({ ...filters, level: e.target.value })}
            className="bg-gray-900 border border-gray-700 rounded px-4 py-2 text-white"
          >
            <option value="">All Levels</option>
            <option value="ERROR">ERROR</option>
            <option value="WARN">WARN</option>
            <option value="INFO">INFO</option>
            <option value="DEBUG">DEBUG</option>
          </select>
          <input
            type="text"
            placeholder="Search keyword..."
            value={filters.keyword}
            onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
            className="bg-gray-900 border border-gray-700 rounded px-4 py-2 text-white"
          />
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No logs matching filters</p>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className="border-l-4 border-gray-700 pl-4 py-3 hover:bg-gray-700/30 transition">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <span className={`px-3 py-1 rounded text-xs font-bold border ${getLevelColor(log.level)}`}>
                      {log.level}
                    </span>
                    <span className="text-gray-400 text-sm font-mono">{log.service}</span>
                    <span className="text-gray-500 text-xs">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <span className="text-gray-500 text-xs">{log.latency_ms}ms</span>
                </div>
                <p className="text-gray-300 mt-2">{log.message}</p>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
