'use client';

import { useState, useEffect } from 'react';

export default function LogStream() {
  const [logs, setLogs] = useState([]);

  const getLevelColor = (level) => {
    switch (level) {
      case 'ERROR': return 'text-red-500';
      case 'WARN': return 'text-yellow-500';
      case 'INFO': return 'text-blue-500';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-bold mb-4">Live Log Stream</h2>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {logs.length === 0 ? (
          <p className="text-gray-400">No logs yet. Waiting for data...</p>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="border-l-4 border-gray-700 pl-4 py-2">
              <div className="flex items-center space-x-4">
                <span className={`font-bold ${getLevelColor(log.level)}`}>
                  {log.level}
                </span>
                <span className="text-gray-400 text-sm">{log.service}</span>
                <span className="text-gray-500 text-xs">{log.timestamp}</span>
              </div>
              <p className="text-gray-300 mt-1">{log.message}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
