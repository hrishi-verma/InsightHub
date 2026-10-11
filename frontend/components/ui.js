'use client';

import { errorMessage } from '../lib/api.js';
import { formatMlScore } from '../lib/format.js';

export function Loading({ label = 'Loading…' }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-10 text-gray-300">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-blue-400" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Could not load this page' }) {
  return (
    <div role="alert" className="rounded-lg border border-red-500/60 bg-red-500/10 p-4 text-red-200">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm">{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-3">
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ children = 'No errors yet 🎉' }) {
  return <p className="card p-8 text-center text-gray-300">{children}</p>;
}

const STATUS_STYLES = {
  unresolved: 'bg-red-500/15 text-red-300 border-red-500/40',
  resolved: 'bg-green-500/15 text-green-300 border-green-500/40',
  ignored: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
};

export function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || STATUS_STYLES.ignored;
  return <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${cls}`}>{String(status)}</span>;
}

export function SourceBadge({ source }) {
  const browser = source === 'browser';
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-200">
      <span className="h-2 w-2 rounded-full" style={{ background: browser ? '#3987e5' : '#d95926' }} aria-hidden="true" />
      {browser ? 'browser' : source === 'server' ? 'server' : String(source)}
    </span>
  );
}

// ML is shadow-only (CLAUDE.md rule 5): always shown with the experimental label.
export function MlScore({ score, version }) {
  const text = formatMlScore(score);
  if (text === null) return null;
  return (
    <div className="rounded border border-yellow-600/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
      <span className="font-semibold">ML score {text}</span>
      {version ? <span className="text-yellow-200/90"> ({String(version)})</span> : null}
      <span className="block text-xs text-yellow-200/90">Experimental: model trained on synthetic data</span>
    </div>
  );
}

export function PageHeader({ title, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
