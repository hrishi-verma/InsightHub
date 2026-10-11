'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { formatNumber, timeAgo } from '../../lib/format.js';
import { useAuth } from '../../components/AuthProvider.js';
import HourlyChart from '../../components/HourlyChart.js';
import { Empty, ErrorState, Loading, PageHeader, SourceBadge, StatusBadge } from '../../components/ui.js';

const RANGES = [
  { hours: 24, label: 'Last 24 hours' },
  { hours: 72, label: 'Last 3 days' },
  { hours: 168, label: 'Last 7 days' },
];
const REFRESH_MS = 60000;

function Stat({ label, value, href, tone = 'text-gray-100' }) {
  const body = (
    <>
      <p className="text-sm uppercase tracking-wide text-gray-300">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${tone}`}>{formatNumber(value)}</p>
    </>
  );
  return href
    ? <Link href={href} className="card focus-ring block p-5 hover:border-gray-500">{body}</Link>
    : <div className="card p-5">{body}</div>;
}

export default function OverviewPage() {
  const { project } = useAuth();
  const [hours, setHours] = useState(24);
  const { data, error, loading, reload } = useApi(() => api.overview(project, hours), [project, hours]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  const hourly = Array.isArray(data?.hourly) ? data.hourly : [];
  const top = Array.isArray(data?.top_issues) ? data.top_issues : [];
  const rangeLabel = RANGES.find((r) => r.hours === hours)?.label.toLowerCase();

  return (
    <div>
      <PageHeader title="Overview">
        <label htmlFor="range" className="sr-only">Time range</label>
        <select id="range" className="input w-auto" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {RANGES.map((r) => <option key={r.hours} value={r.hours}>{r.label}</option>)}
        </select>
        <button type="button" className="btn-secondary" onClick={reload} disabled={loading}>Refresh</button>
      </PageHeader>

      {error && <div className="mb-6"><ErrorState error={error} onRetry={reload} /></div>}
      {!data && loading && <Loading />}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label={`Events (${rangeLabel})`} value={data.events_total} />
            <Stat label="New issues" value={data.new_issues} href="/issues?sort=first_seen" />
            <Stat label="Unresolved issues" value={data.unresolved_issues} href="/issues?status=unresolved" tone="text-red-300" />
            <Stat label="Open alerts" value={data.open_alerts} href="/alerts" tone="text-yellow-300" />
          </div>

          {Number(data.events_total) === 0 && top.length === 0 ? (
            <Empty />
          ) : (
            <>
              <div className="card p-5">
                <HourlyChart
                  title="Events per hour"
                  data={hourly}
                  series={[{ key: 'browser', label: 'Browser' }, { key: 'server', label: 'Server' }]}
                />
              </div>

              <section className="card p-5" aria-labelledby="top-issues">
                <h2 id="top-issues" className="mb-3 text-lg font-bold">Top issues</h2>
                {top.length === 0 ? (
                  <p className="text-gray-300">No unresolved issues.</p>
                ) : (
                  <ol className="divide-y divide-gray-700">
                    {top.map((issue) => (
                      <li key={issue.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <Link href={`/issues/${encodeURIComponent(issue.id)}`} className="focus-ring block break-words rounded font-semibold text-blue-300 hover:underline">
                            {issue.title}
                          </Link>
                          <p className="truncate text-sm text-gray-400">{issue.culprit}</p>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-300">
                          <SourceBadge source={issue.source} />
                          <StatusBadge status={issue.status} />
                          <span className="tabular-nums">{formatNumber(issue.event_count)} events</span>
                          <span>{timeAgo(issue.last_seen)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
