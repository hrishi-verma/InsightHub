'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { formatDateTime, timeAgo } from '../../lib/format.js';
import { useAuth } from '../../components/AuthProvider.js';
import { Empty, ErrorState, Loading, PageHeader } from '../../components/ui.js';

const KINDS = {
  new_issue: { label: 'New issue', cls: 'border-blue-500/50 bg-blue-500/15 text-blue-200' },
  spike: { label: 'Spike', cls: 'border-red-500/50 bg-red-500/15 text-red-200' },
  regression: { label: 'Regression', cls: 'border-yellow-500/50 bg-yellow-500/15 text-yellow-200' },
};

// `details` is free-form JSON from the processor: show it as plain key/value text.
function Details({ details }) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const entries = Object.entries(details).slice(0, 20);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-300">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <dt className="text-gray-400">{k.replace(/_/g, ' ')}:</dt>
          <dd className="break-all">{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AlertsPage() {
  const { project, isAdmin } = useAuth();
  const [showAcked, setShowAcked] = useState(false);
  const { data, error, loading, reload, setData } = useApi(() => api.alerts(project, showAcked), [project, showAcked]);
  const [acking, setAcking] = useState(null);
  const [ackError, setAckError] = useState(null);

  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];

  const acknowledge = async (id) => {
    setAcking(id);
    setAckError(null);
    try {
      await api.ackAlert(id);
      setData((d) => ({ ...d, alerts: (d?.alerts || []).filter((a) => a.id !== id) }));
    } catch (e) {
      setAckError(errorMessage(e));
    } finally {
      setAcking(null);
    }
  };

  return (
    <div>
      <PageHeader title={showAcked ? 'Acknowledged alerts' : 'Open alerts'}>
        <button type="button" className="btn-secondary" aria-pressed={showAcked} onClick={() => setShowAcked((v) => !v)}>
          {showAcked ? 'Show open alerts' : 'Show acknowledged'}
        </button>
        <button type="button" className="btn-secondary" onClick={reload} disabled={loading}>Refresh</button>
      </PageHeader>

      <p className="mb-6 text-sm text-gray-300">
        Alerts are raised by fixed rules: a new issue, a spike in events, or a resolved issue coming back.
      </p>

      {ackError && <p role="alert" className="mb-4 text-sm text-red-300">Could not acknowledge: {ackError}</p>}
      {error && <div className="mb-6"><ErrorState error={error} onRetry={reload} /></div>}
      {!data && loading && <Loading />}
      {data && alerts.length === 0 && (
        <Empty>{showAcked ? 'No acknowledged alerts.' : 'No open alerts 🎉'}</Empty>
      )}

      {alerts.length > 0 && (
        <ul className="space-y-3">
          {alerts.map((alert) => {
            const kind = KINDS[alert.kind] || { label: String(alert.kind), cls: 'border-gray-500 text-gray-200' };
            return (
              <li key={alert.id} className="card flex flex-wrap items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${kind.cls}`}>{kind.label}</span>
                    <span className="text-sm text-gray-300" title={formatDateTime(alert.created_at)}>{timeAgo(alert.created_at)}</span>
                    {alert.acknowledged_at && (
                      <span className="text-sm text-gray-400">· acknowledged {timeAgo(alert.acknowledged_at)}</span>
                    )}
                  </div>
                  {alert.issue && (
                    <Link href={`/issues/${encodeURIComponent(alert.issue.id)}`} className="focus-ring mt-2 block break-words rounded font-semibold text-blue-300 hover:underline">
                      {alert.issue.title}
                    </Link>
                  )}
                  <Details details={alert.details} />
                </div>
                {isAdmin && !alert.acknowledged_at && (
                  <button type="button" className="btn-primary" disabled={acking !== null} onClick={() => acknowledge(alert.id)}>
                    {acking === alert.id ? 'Saving…' : 'Acknowledge'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
