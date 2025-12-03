'use client';

import { useState } from 'react';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([
    {
      id: 1,
      name: 'High Error Rate',
      condition: 'error_rate > 50',
      service: 'payment-service',
      enabled: true,
      channel: 'slack'
    },
    {
      id: 2,
      name: 'Latency Spike',
      condition: 'avg_latency > 1000',
      service: 'api-gateway',
      enabled: true,
      channel: 'email'
    }
  ]);

  const [showModal, setShowModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    condition: '',
    service: '',
    channel: 'slack'
  });

  const handleCreate = () => {
    setEditingAlert(null);
    setFormData({ name: '', condition: '', service: '', channel: 'slack' });
    setShowModal(true);
  };

  const handleEdit = (alert) => {
    setEditingAlert(alert);
    setFormData(alert);
    setShowModal(true);
  };

  const handleSave = () => {
    if (editingAlert) {
      setAlerts(alerts.map(a => a.id === editingAlert.id ? { ...formData, id: a.id, enabled: a.enabled } : a));
    } else {
      setAlerts([...alerts, { ...formData, id: Date.now(), enabled: true }]);
    }
    setShowModal(false);
  };

  const handleDelete = (id) => {
    setAlerts(alerts.filter(a => a.id !== id));
  };

  const toggleAlert = (id) => {
    setAlerts(alerts.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Alert Rules</h1>
        <button
          onClick={handleCreate}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-semibold"
        >
          + Create Alert
        </button>
      </div>

      <div className="space-y-4">
        {alerts.map((alert) => (
          <div key={alert.id} className="bg-gray-800 p-6 rounded-lg border border-gray-700">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center space-x-3">
                  <h3 className="text-xl font-bold">{alert.name}</h3>
                  <span className={`px-3 py-1 rounded text-xs font-bold ${
                    alert.enabled ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'
                  }`}>
                    {alert.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  <p className="text-gray-400">
                    <span className="font-semibold">Condition:</span> <code className="bg-gray-900 px-2 py-1 rounded">{alert.condition}</code>
                  </p>
                  <p className="text-gray-400">
                    <span className="font-semibold">Service:</span> {alert.service}
                  </p>
                  <p className="text-gray-400">
                    <span className="font-semibold">Channel:</span> {alert.channel}
                  </p>
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => toggleAlert(alert.id)}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                >
                  {alert.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => handleEdit(alert)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(alert.id)}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4">
              {editingAlert ? 'Edit Alert' : 'Create Alert'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Alert Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2"
                  placeholder="High Error Rate"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Condition</label>
                <input
                  type="text"
                  value={formData.condition}
                  onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2"
                  placeholder="error_rate > 50"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Service</label>
                <input
                  type="text"
                  value={formData.service}
                  onChange={(e) => setFormData({ ...formData, service: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2"
                  placeholder="payment-service"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Notification Channel</label>
                <select
                  value={formData.channel}
                  onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2"
                >
                  <option value="slack">Slack</option>
                  <option value="email">Email</option>
                  <option value="webhook">Webhook</option>
                </select>
              </div>
            </div>
            <div className="flex space-x-3 mt-6">
              <button
                onClick={handleSave}
                className="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-semibold"
              >
                Save
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
