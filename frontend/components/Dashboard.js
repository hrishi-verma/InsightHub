export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 p-6 rounded-lg">
          <h3 className="text-gray-400 text-sm">Total Logs</h3>
          <p className="text-3xl font-bold mt-2">0</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg">
          <h3 className="text-gray-400 text-sm">Errors</h3>
          <p className="text-3xl font-bold mt-2 text-red-500">0</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg">
          <h3 className="text-gray-400 text-sm">Anomalies</h3>
          <p className="text-3xl font-bold mt-2 text-yellow-500">0</p>
        </div>
      </div>
      
      <div className="bg-gray-800 p-6 rounded-lg">
        <h2 className="text-xl font-bold mb-4">Analytics</h2>
        <p className="text-gray-400">Charts will be displayed here</p>
      </div>
    </div>
  );
}
