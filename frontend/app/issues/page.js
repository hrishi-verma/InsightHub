'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api.js';
import { formatDateTime, formatNumber, timeAgo } from '../../lib/format.js';
import { useAuth } from '../../components/AuthProvider.js';
import { Empty, ErrorState, Loading, PageHeader, SourceBadge, StatusBadge } from '../../components/ui.js';

const PAGE_SIZE = 25;
const OPTIONS = {
  status: [['', 'Any status'], ['unresolved', 'Unresolved'], ['resolved', 'Resolved'], ['ignored', 'Ignored']],
  source: [['', 'Any source'], ['browser', 'Browser'], ['server', 'Server']],
  environment: [['', 'Any environment'], ['production', 'Production'], ['preview', 'Preview'], ['development', 'Development']],
  sort: [['last_seen', 'Last seen'], ['first_seen', 'First seen'], ['event_count', 'Most events']],
};
const LABELS = { status: 'Status', source: 'Source', environment: 'Environment', sort: 'Sort by' };

// URL params are user-controlled: only known values are kept.
function pick(params, key, fallback) {
  const v = params.get(key);
  return OPTIONS[key].some(([value]) => value === v) ? v : fallback;
}

function IssuesView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { project } = useAuth();

  const filters = {
    status: pick(params, 'status', 'unresolved'),
    source: pick(params, 'source', ''),
    environment: pick(params, 'environment', ''),
    sort: pick(params, 'sort', 'last_seen'),
    q: (params.get('q') || '').slice(0, 200),
  };
  const filterKey = JSON.stringify(filters);

  const [search, setSearch] = useState(filters.q);
  const [issues, setIssues] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const callId = useRef(0);

  const setFilter = useCallback((key, value) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    // "Any status" needs an explicit marker, since the default is unresolved.
    if (key === 'status' && !value) next.set('status', 'any');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  // Debounced search box → URL.
  useEffect(() => {
    if (search === filters.q) return undefined;
    const t = setTimeout(() => setFilter('q', search.trim().slice(0, 200)), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const load = useCallback(async (append, fromCursor) => {
    const id = ++callId.current;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const res = await api.issues({ project, ...filters, limit: PAGE_SIZE, cursor: append ? fromCursor : undefined });
      if (id !== callId.current) return;
      const list = Array.isArray(res.issues) ? res.issues : [];
      setIssues((cur) => (append ? [...cur, ...list] : list));
      setCursor(typeof res.next_cursor === 'string' ? res.next_cursor : null);
    } catch (e) {
      if (id === callId.current) setError(e);
    } finally {
      if (id === callId.current) { setLoading(false); setLoadingMore(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, filterKey]);

  useEffect(() => { load(false); }, [load]);

  const statusValue = params.get('status') === 'any' ? '' : filters.status;
  const filtered = filters.q || filters.source || filters.environment || filters.status !== 'unresolved';

  return (
    <div>
      <PageHeader title="Issues" />

      <form role="search" className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()}>
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="q" className="label">Search titles</label>
          <input id="q" type="search" className="input" maxLength={200} value={search}
            onChange={(e) => setSearch(e.target.value)} placeholder="e.g. TypeError" />
        </div>
        {['status', 'source', 'environment', 'sort'].map((key) => (
          <div key={key}>
            <label htmlFor={`f-${key}`} className="label">{LABELS[key]}</label>
            <select id={`f-${key}`} className="input"
              value={key === 'status' ? statusValue : filters[key]}
              onChange={(e) => setFilter(key, e.target.value)}>
              {OPTIONS[key].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        ))}
      </form>

      {error && <div className="mb-6"><ErrorState error={error} onRetry={() => load(false)} /></div>}
      {loading && <Loading />}

      {!loading && !error && issues.length === 0 && (
        <Empty>{filtered ? 'No issues match these filters.' : 'No errors yet 🎉'}</Empty>
      )}

      {!loading && issues.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-gray-700 text-gray-300">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Issue</th>
                <th scope="col" className="px-4 py-3 font-semibold">Source</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Events</th>
                <th scope="col" className="px-4 py-3 font-semibold">Last seen</th>
                <th scope="col" className="px-4 py-3 font-semibold">First seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {issues.map((issue) => (
                <tr key={issue.id} className="align-top hover:bg-gray-700/40">
                  <td className="max-w-md px-4 py-3">
                    <Link href={`/issues/${encodeURIComponent(issue.id)}`} className="focus-ring block break-words rounded font-semibold text-blue-300 hover:underline">
                      {issue.title}
                    </Link>
                    <p className="mt-0.5 break-words text-gray-400">{issue.culprit}</p>
                  </td>
                  <td className="px-4 py-3"><SourceBadge source={issue.source} /></td>
                  <td className="px-4 py-3"><StatusBadge status={issue.status} /></td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(issue.event_count)}</td>
                  <td className="whitespace-nowrap px-4 py-3" title={formatDateTime(issue.last_seen)}>{timeAgo(issue.last_seen)}</td>
                  <td className="whitespace-nowrap px-4 py-3" title={formatDateTime(issue.first_seen)}>{timeAgo(issue.first_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && cursor && (
        <div className="mt-4 text-center">
          <button type="button" className="btn-secondary" disabled={loadingMore} onClick={() => load(true, cursor)}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function IssuesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <IssuesView />
    </Suspense>
  );
}
