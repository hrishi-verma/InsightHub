// Display helpers. Inputs come from the API, so every one tolerates bad values.

function toDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(iso) {
  const d = toDate(iso);
  return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function formatHour(iso, withDay = false) {
  const d = toDate(iso);
  if (!d) return '';
  return withDay
    ? d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso, now = Date.now()) {
  const d = toDate(iso);
  if (!d) return '—';
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString() : '—';
}

// Only finite numbers in [0, 1] are shown; anything else is treated as "no score".
export function formatMlScore(score) {
  const v = typeof score === 'number' ? score : Number.NaN;
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v.toFixed(2) : null;
}
