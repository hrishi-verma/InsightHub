// Storing an event, contract §3. Runs inside the caller's transaction. Parameterised SQL only.

/**
 * Step 1: upsert the issue without counting. The no-op DO UPDATE locks the row until commit,
 * so concurrent events for one issue are serialised (counts, status flips and cooldowns stay correct).
 */
async function upsertIssue(client, projectId, event, desc) {
  const { rows } = await client.query(
    `INSERT INTO issues (project_id, fingerprint, source, error_type, title, culprit, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (project_id, fingerprint) DO UPDATE SET fingerprint = EXCLUDED.fingerprint
     RETURNING id, status, resolved_at, (xmax = 0) AS created`,
    [projectId, desc.fingerprint, event.source, event.error_type, desc.title, desc.culprit, event.occurred_at],
  );
  return rows[0];
}

/** Step 2: insert the event. Returns false if (event_id, occurred_at) was already stored. */
async function insertEvent(client, msg, issueId, ml) {
  const e = msg.event;
  const http = e.http || {};
  const { rowCount } = await client.query(
    `INSERT INTO error_events (
       event_id, occurred_at, received_at, project_id, issue_id, source, environment, level,
       error_type, message, stack, release, url_path, http_method, http_status, http_route,
       runtime, tags, ml_score, ml_model_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     ON CONFLICT (event_id, occurred_at) DO NOTHING`,
    [
      e.event_id, e.occurred_at, msg.received_at, msg.project_id, issueId, e.source, e.environment,
      e.level, e.error_type, e.message, e.stack ?? null, e.release ?? null, e.url_path ?? null,
      http.method ?? null, http.status ?? null, http.route ?? null, e.runtime ?? null,
      JSON.stringify(e.tags || {}), ml.ml_score, ml.ml_model_version,
    ],
  );
  return rowCount === 1;
}

/** Step 3: count the event. last_release only moves forward with the newest event. */
async function countEvent(client, issueId, event) {
  await client.query(
    `UPDATE issues SET
       event_count  = event_count + 1,
       last_seen    = GREATEST(last_seen, $2::timestamptz),
       first_seen   = LEAST(first_seen, $2::timestamptz),
       last_release = CASE WHEN $2::timestamptz >= last_seen THEN COALESCE($3::text, last_release) ELSE last_release END
     WHERE id = $1`,
    [issueId, event.occurred_at, event.release ?? null],
  );
}

module.exports = { upsertIssue, insertEvent, countEvent };
