// Alert rules, contract §3. Runs in the same transaction as the event insert, after the issue
// row has been locked. Deliberately plain SQL so the behaviour is easy to audit.
// The ML score is not an input here (ML is shadow-only).

async function raise(client, projectId, issueId, kind, details) {
  await client.query(
    `INSERT INTO issue_alerts (project_id, issue_id, kind, details) VALUES ($1, $2, $3, $4)`,
    [projectId, issueId, kind, JSON.stringify(details)],
  );
  return { kind, details };
}

/**
 * spike: events in the last window >= max(minCount, multiplier × average window count over the
 * baseline period before it). Cheap checks first, and every count is an index range scan on
 * error_events(issue_id, occurred_at) with a LIMIT, so a hot issue can't make this unbounded.
 */
async function checkSpike(client, issueId, occurredAt, r) {
  const cooling = await client.query(
    `SELECT 1 FROM issue_alerts
     WHERE issue_id = $1 AND kind = 'spike' AND created_at > now() - make_interval(mins => $2)
     LIMIT 1`,
    [issueId, r.spikeCooldownMinutes],
  );
  if (cooling.rowCount > 0) return null;

  // Window ends at the event's time (clamped to now) so late events are judged in their own window.
  const recentCap = 1000000;
  const { rows: [{ ref, recent }] } = await client.query(
    `SELECT ref, (SELECT count(*) FROM (
        SELECT 1 FROM error_events
        WHERE issue_id = $1 AND occurred_at > ref - make_interval(mins => $3) AND occurred_at <= ref
        LIMIT $4) s)::int AS recent
     FROM (SELECT LEAST($2::timestamptz, now()) AS ref) t`,
    [issueId, occurredAt, r.spikeWindowMinutes, recentCap],
  );
  if (recent < r.spikeMinCount) return null;

  // The spike fires only if baseline ≤ recent × periods / multiplier, so counting can stop there.
  const periods = (r.spikeBaselineHours * 60) / r.spikeWindowMinutes;
  const baselineCap = Math.floor((recent * periods) / r.spikeMultiplier);
  const { rows: [{ baseline }] } = await client.query(
    `SELECT count(*)::int AS baseline FROM (
       SELECT 1 FROM error_events
       WHERE issue_id = $1
         AND occurred_at >  $2::timestamptz - make_interval(mins => $3) - make_interval(hours => $4)
         AND occurred_at <= $2::timestamptz - make_interval(mins => $3)
       LIMIT $5) s`,
    [issueId, ref, r.spikeWindowMinutes, r.spikeBaselineHours, baselineCap + 1],
  );
  if (baseline > baselineCap) return null;

  const baselineAvg = baseline / periods;
  const threshold = Math.max(r.spikeMinCount, r.spikeMultiplier * baselineAvg);
  if (recent < threshold) return null;
  return {
    window_minutes: r.spikeWindowMinutes,
    count: recent,
    baseline_avg: Math.round(baselineAvg * 100) / 100,
    threshold: Math.round(threshold * 100) / 100,
  };
}

/**
 * Applies the rules for one newly stored event. `issue` is the row returned by upsertIssue
 * (status as it was before this event). Returns the alerts raised.
 */
async function applyRules(client, { projectId, issue, event }, rulesConfig) {
  if (issue.status === 'ignored') return []; // stored and counted, but silent

  const alerts = [];
  if (issue.created) {
    alerts.push(await raise(client, projectId, issue.id, 'new_issue', { event_id: event.event_id }));
  }
  if (issue.status === 'resolved') {
    await client.query(
      `UPDATE issues SET status = 'unresolved', resolved_at = NULL WHERE id = $1`,
      [issue.id],
    );
    alerts.push(await raise(client, projectId, issue.id, 'regression', {
      event_id: event.event_id,
      resolved_at: issue.resolved_at ? new Date(issue.resolved_at).toISOString() : null,
      release: event.release ?? null,
    }));
  }
  const spike = await checkSpike(client, issue.id, event.occurred_at, rulesConfig);
  if (spike) alerts.push(await raise(client, projectId, issue.id, 'spike', spike));
  return alerts;
}

module.exports = { applyRules };
