'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError, errorMessage } from '../../../lib/api.js';
import { useApi } from '../../../lib/useApi.js';
import { formatDateTime, formatNumber, timeAgo } from '../../../lib/format.js';
import { useAuth } from '../../../components/AuthProvider.js';
import HourlyChart from '../../../components/HourlyChart.js';
import { Empty, ErrorState, Loading, MlScore, SourceBadge, StatusBadge } from '../../../components/ui.js';

const EVENTS_PAGE = 20;

const ACTIONS = {
  unresolved: [['resolved', 'Resolve', 'btn-primary'], ['ignored', 'Ignore', 'btn-secondary']],
  resolved: [['unresolved', 'Reopen', 'btn-secondary']],
  ignored: [['unresolved', 'Reopen', 'btn-secondary']],
};

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 break-words text-gray-100">{children}</dd>
    </div>
  );
}

function EventCard({ event, defaultOpen }) {
  const http = event.http && typeof event.http === 'object' ? event.http : null;
  const tags = event.tags && typeof event.tags === 'object' ? Object.entries(event.tags) : [];
  return (
    <li className="card p-4">
      <details open={defaultOpen}>
        <summary className="focus-ring cursor-pointer rounded">
          <span className="font-semibold">{formatDateTime(event.occurred_at)}</span>
          <span className="ml-2 text-sm text-gray-300">
            {String(event.level)} · {String(event.environment)}
            {event.url_path ? ` · ${event.url_path}` : ''}
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          <p className="whitespace-pre-wrap break-words text-gray-100">
            <span className="font-semibold">{event.error_type}:</span> {event.message}
          </p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Field label="Release">{event.release || '—'}</Field>
            <Field label="Path">{event.url_path || '—'}</Field>
            <Field label="Runtime">{event.runtime || '—'}</Field>
            <Field label="Received">{formatDateTime(event.received_at)}</Field>
            {http && <Field label="HTTP">{[http.method, http.status, http.route].filter((v) => v !== undefined && v !== null).join(' ') || '—'}</Field>}
            <Field label="Event ID"><span className="font-mono text-xs">{event.event_id}</span></Field>
          </dl>
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-xs" aria-label="Tags">
              {tags.map(([k, v]) => (
                <li key={k} className="rounded border border-gray-600 px-2 py-0.5 text-gray-200">{k}: {String(v)}</li>
              ))}
            </ul>
          )}
          <MlScore score={event.ml_score} version={event.ml_model_version} />
          {event.stack ? (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-gray-300">Stack trace</h4>
              {/* Attacker-controllable text: rendered as a plain text node only. */}
              <pre className="max-h-96 overflow-auto rounded bg-gray-950 p-3 text-xs leading-relaxed text-gray-200">{String(event.stack)}</pre>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No stack trace.</p>
          )}
        </div>
      </details>
    </li>
  );
}

export default function IssueDetailPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const issueReq = useApi(() => api.issue(id), [id]);
  const issue = issueReq.data?.issue;

  const [events, setEvents] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [actionError, setActionError] = useState(null);
  const callId = useRef(0);

  const loadEvents = useCallback(async (append, fromCursor) => {
    const call = ++callId.current;
    setEventsLoading(true);
    setEventsError(null);
    try {
      const res = await api.issueEvents(id, { limit: EVENTS_PAGE, cursor: append ? fromCursor : undefined });
      if (call !== callId.current) return;
      const list = Array.isArray(res.events) ? res.events : [];
      setEvents((cur) => (append ? [...cur, ...list] : list));
      setCursor(typeof res.next_cursor === 'string' ? res.next_cursor : null);
    } catch (e) {
      if (call === callId.current) setEventsError(e);
    } finally {
      if (call === callId.current) setEventsLoading(false);
    }
  }, [id]);

  useEffect(() => { loadEvents(false); }, [loadEvents]);

  const changeStatus = async (status) => {
    setUpdating(status);
    setActionError(null);
    try {
      const res = await api.setIssueStatus(id, status);
      issueReq.setData((d) => ({ ...d, issue: res.issue }));
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setUpdating(null);
    }
  };

  if (issueReq.error) {
    const notFound = issueReq.error instanceof ApiError && issueReq.error.status === 404;
    return (
      <div className="space-y-4">
        <Link href="/issues" className="focus-ring rounded text-sm text-blue-300 hover:underline">← All issues</Link>
        {notFound ? <Empty>Issue not found.</Empty> : <ErrorState error={issueReq.error} onRetry={issueReq.reload} />}
      </div>
    );
  }
  if (!issue) return <Loading />;

  const hourly = Array.isArray(issueReq.data.hourly) ? issueReq.data.hourly : [];

  return (
    <div className="space-y-6">
      <Link href="/issues" className="focus-ring rounded text-sm text-blue-300 hover:underline">← All issues</Link>

      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-bold sm:text-2xl">{issue.title}</h1>
            <p className="mt-1 break-words font-mono text-sm text-gray-300">{issue.culprit || '—'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge status={issue.status} />
              <SourceBadge source={issue.source} />
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              {(ACTIONS[issue.status] || []).map(([status, label, cls]) => (
                <button key={status} type="button" className={cls} disabled={updating !== null} onClick={() => changeStatus(status)}>
                  {updating === status ? 'Saving…' : label}
                </button>
              ))}
            </div>
          )}
        </div>
        {actionError && <p role="alert" className="mt-3 text-sm text-red-300">Could not update the issue: {actionError}</p>}
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Field label="Events">{formatNumber(issue.event_count)}</Field>
          <Field label="First seen"><span title={formatDateTime(issue.first_seen)}>{timeAgo(issue.first_seen)}</span></Field>
          <Field label="Last seen"><span title={formatDateTime(issue.last_seen)}>{timeAgo(issue.last_seen)}</span></Field>
          <Field label="Last release">{issue.last_release || '—'}</Field>
        </dl>
      </header>

      <div className="card p-5">
        <HourlyChart title="Events in the last 24 hours" data={hourly} series={[{ key: 'count', label: 'Events' }]} />
      </div>

      <section aria-labelledby="events-heading">
        <h2 id="events-heading" className="mb-3 text-lg font-bold">Recent events</h2>
        {eventsError && <div className="mb-4"><ErrorState error={eventsError} onRetry={() => loadEvents(false)} title="Could not load events" /></div>}
        {eventsLoading && events.length === 0 && <Loading label="Loading events…" />}
        {!eventsLoading && !eventsError && events.length === 0 && <Empty>No events stored for this issue.</Empty>}
        {events.length > 0 && (
          <ul className="space-y-3">
            {events.map((ev, i) => <EventCard key={`${ev.event_id}-${ev.occurred_at}`} event={ev} defaultOpen={i === 0} />)}
          </ul>
        )}
        {cursor && events.length > 0 && (
          <div className="mt-4 text-center">
            <button type="button" className="btn-secondary" disabled={eventsLoading} onClick={() => loadEvents(true, cursor)}>
              {eventsLoading ? 'Loading…' : 'Load more events'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
