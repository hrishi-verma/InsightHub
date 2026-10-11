// DB rows → contract §4 shapes. Timestamps as ISO 8601 UTC.

const iso = (d) => (d == null ? null : new Date(d).toISOString());

function issue(row) {
  return {
    id: Number(row.id),
    project: row.project,
    fingerprint: row.fingerprint,
    source: row.source,
    error_type: row.error_type,
    title: row.title,
    culprit: row.culprit,
    status: row.status,
    first_seen: iso(row.first_seen),
    last_seen: iso(row.last_seen),
    event_count: Number(row.event_count),
    last_release: row.last_release,
  };
}

function event(row) {
  const out = {
    event_id: row.event_id,
    occurred_at: iso(row.occurred_at),
    source: row.source,
    environment: row.environment,
    level: row.level,
    error_type: row.error_type,
    message: row.message,
  };
  if (row.stack != null) out.stack = row.stack;
  if (row.release != null) out.release = row.release;
  if (row.url_path != null) out.url_path = row.url_path;
  if (row.http_method != null || row.http_status != null || row.http_route != null) {
    out.http = {};
    if (row.http_method != null) out.http.method = row.http_method;
    if (row.http_status != null) out.http.status = row.http_status;
    if (row.http_route != null) out.http.route = row.http_route;
  }
  if (row.runtime != null) out.runtime = row.runtime;
  if (row.tags && Object.keys(row.tags).length > 0) out.tags = row.tags;
  out.received_at = iso(row.received_at);
  out.ml_score = row.ml_score;
  out.ml_model_version = row.ml_model_version;
  return out;
}

function alert(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    issue: { id: Number(row.issue_id), title: row.issue_title },
    details: row.details,
    created_at: iso(row.created_at),
    acknowledged_at: iso(row.acknowledged_at),
  };
}

module.exports = { issue, event, alert, iso };
