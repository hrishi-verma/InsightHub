const express = require('express');
const { z } = require('zod');
const { ApiError } = require('../../lib/errors');
const { requireSession, requireAdmin } = require('../../middleware/dashboard');
const cursor = require('../../services/cursor');
const serialize = require('../../services/serialize');

const slug = z.string().regex(/^[a-z0-9-]{1,64}$/, 'must be a project slug');
const ID = /^[1-9]\d{0,17}$/;

// Sort columns come only from this map, never from the request.
const ISSUE_SORTS = {
  last_seen: { col: 'i.last_seen', cast: 'timestamptz', value: cursor.pgTimestampText },
  first_seen: { col: 'i.first_seen', cast: 'timestamptz', value: cursor.pgTimestampText },
  event_count: { col: 'i.event_count', cast: 'bigint', value: cursor.bigintText },
};

const ISSUE_COLUMNS = `i.id, p.slug AS project, i.fingerprint, i.source, i.error_type, i.title, i.culprit,
  i.status, i.first_seen, i.last_seen, i.event_count, i.last_release,
  i.status_changed_at, u.email AS status_changed_by`;

function parseQuery(schema, query) {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? issue.path.join('.') : 'query';
    const message = issue.code === 'unrecognized_keys' ? 'unknown parameter(s)' : issue.message;
    throw new ApiError('VALIDATION_ERROR', `${where}: ${message}`.slice(0, 200));
  }
  return parsed.data;
}

const intParam = (min, max, dflt) =>
  z
    .string()
    .regex(/^\d{1,4}$/, 'must be an integer')
    .transform(Number)
    .pipe(z.number().min(min).max(max))
    .optional()
    .transform((n) => n ?? dflt);

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function parseId(raw) {
  if (!ID.test(raw)) throw new ApiError('NOT_FOUND', 'Not found');
  return raw;
}

function createDashboardRouter({ pool, sessions }) {
  const router = express.Router();
  router.use(requireSession(sessions));

  async function projectBySlug(value) {
    const { rows } = await pool.query('SELECT id, slug FROM projects WHERE slug = $1', [value]);
    if (!rows[0]) throw new ApiError('NOT_FOUND', 'Project not found');
    return rows[0];
  }

  // Optional ?project= on /issues/:id and /alerts/:id scopes the lookup; a mismatch is a 404.
  async function optionalProjectId(query) {
    const { project } = parseQuery(z.strictObject({ project: slug.optional() }), query);
    return project ? (await projectBySlug(project)).id : null;
  }

  async function loadIssue(id, projectId) {
    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLUMNS} FROM issues i JOIN projects p ON p.id = i.project_id
         LEFT JOIN users u ON u.id = i.status_changed_by
        WHERE i.id = $1 AND ($2::int IS NULL OR i.project_id = $2)`,
      [id, projectId],
    );
    if (!rows[0]) throw new ApiError('NOT_FOUND', 'Issue not found');
    return rows[0];
  }

  router.get('/projects', asyncRoute(async (req, res) => {
    parseQuery(z.strictObject({}), req.query);
    const { rows } = await pool.query('SELECT id, slug, name FROM projects ORDER BY id');
    res.json({ projects: rows });
  }));

  router.get('/overview', asyncRoute(async (req, res) => {
    const q = parseQuery(z.strictObject({ project: slug, hours: intParam(1, 168, 24) }), req.query);
    const project = await projectBySlug(q.project);
    const params = [project.id, q.hours];
    const [totals, hourly, top] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT count(*) FROM error_events
             WHERE project_id = $1 AND occurred_at > now() - make_interval(hours => $2)) AS events_total,
           (SELECT count(*) FROM issues
             WHERE project_id = $1 AND first_seen > now() - make_interval(hours => $2)) AS new_issues,
           (SELECT count(*) FROM issues WHERE project_id = $1 AND status = 'unresolved') AS unresolved_issues,
           (SELECT count(*) FROM issue_alerts WHERE project_id = $1 AND acknowledged_at IS NULL) AS open_alerts`,
        params,
      ),
      pool.query(
        `SELECT h.hour, coalesce(c.browser, 0) AS browser, coalesce(c.server, 0) AS server
           FROM generate_series(date_trunc('hour', now()) - make_interval(hours => $2 - 1),
                                date_trunc('hour', now()), interval '1 hour') AS h(hour)
           LEFT JOIN (
             SELECT date_trunc('hour', occurred_at) AS hour,
                    count(*) FILTER (WHERE source = 'browser') AS browser,
                    count(*) FILTER (WHERE source = 'server') AS server
               FROM error_events
              WHERE project_id = $1 AND occurred_at >= date_trunc('hour', now()) - make_interval(hours => $2 - 1)
              GROUP BY 1
           ) c USING (hour)
          ORDER BY h.hour`,
        params,
      ),
      pool.query(
        `SELECT ${ISSUE_COLUMNS}
           FROM (SELECT issue_id, count(*) AS n FROM error_events
                  WHERE project_id = $1 AND occurred_at > now() - make_interval(hours => $2)
                  GROUP BY issue_id ORDER BY n DESC, issue_id DESC LIMIT 5) t
           JOIN issues i ON i.id = t.issue_id
           JOIN projects p ON p.id = i.project_id
           LEFT JOIN users u ON u.id = i.status_changed_by
          ORDER BY t.n DESC, i.id DESC`,
        params,
      ),
    ]);
    const t = totals.rows[0];
    res.json({
      events_total: Number(t.events_total),
      new_issues: Number(t.new_issues),
      unresolved_issues: Number(t.unresolved_issues),
      open_alerts: Number(t.open_alerts),
      hourly: hourly.rows.map((r) => ({ hour: serialize.iso(r.hour), browser: Number(r.browser), server: Number(r.server) })),
      top_issues: top.rows.map(serialize.issue),
    });
  }));

  router.get('/issues', asyncRoute(async (req, res) => {
    const q = parseQuery(
      z.strictObject({
        project: slug,
        status: z.enum(['unresolved', 'resolved', 'ignored']).optional(),
        source: z.enum(['browser', 'server']).optional(),
        environment: z.enum(['production', 'preview', 'development']).optional(),
        q: z.string().max(200).optional(),
        sort: z.enum(['last_seen', 'first_seen', 'event_count']).optional().default('last_seen'),
        cursor: z.string().optional(),
        limit: intParam(1, 100, 25),
      }),
      req.query,
    );
    const sort = ISSUE_SORTS[q.sort];
    const after = cursor.decode(q.cursor, z.strictObject({ s: z.literal(q.sort), v: sort.value, id: cursor.bigintText }));
    const project = await projectBySlug(q.project);

    const params = [project.id];
    const where = ['i.project_id = $1'];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.status) add('i.status = ?', q.status);
    if (q.source) add('i.source = ?', q.source);
    if (q.environment) {
      add('EXISTS (SELECT 1 FROM error_events e WHERE e.issue_id = i.id AND e.project_id = i.project_id AND e.environment = ?)', q.environment);
    }
    if (q.q) add(`i.title ILIKE ? ESCAPE '\\'`, `%${q.q.replace(/[\\%_]/g, '\\$&')}%`);
    if (after) {
      params.push(after.v, after.id);
      where.push(`(${sort.col}, i.id) < ($${params.length - 1}::${sort.cast}, $${params.length}::bigint)`);
    }
    params.push(q.limit + 1);

    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLUMNS}, ${sort.col}::text AS cursor_value
         FROM issues i JOIN projects p ON p.id = i.project_id
         LEFT JOIN users u ON u.id = i.status_changed_by
        WHERE ${where.join(' AND ')}
        ORDER BY ${sort.col} DESC, i.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    res.json({
      issues: page.map(serialize.issue),
      next_cursor: rows.length > q.limit ? cursor.encode({ s: q.sort, v: last.cursor_value, id: String(last.id) }) : null,
    });
  }));

  router.get('/issues/:id', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const issue = await loadIssue(id, await optionalProjectId(req.query));
    const { rows } = await pool.query(
      `SELECT h.hour, coalesce(c.n, 0) AS count
         FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') AS h(hour)
         LEFT JOIN (
           SELECT date_trunc('hour', occurred_at) AS hour, count(*) AS n
             FROM error_events
            WHERE issue_id = $1 AND occurred_at >= date_trunc('hour', now()) - interval '23 hours'
            GROUP BY 1
         ) c USING (hour)
        ORDER BY h.hour`,
      [id],
    );
    res.json({
      issue: serialize.issue(issue),
      hourly: rows.map((r) => ({ hour: serialize.iso(r.hour), count: Number(r.count) })),
    });
  }));

  router.get('/issues/:id/events', asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const q = parseQuery(
      z.strictObject({ project: slug.optional(), cursor: z.string().optional(), limit: intParam(1, 50, 20) }),
      req.query,
    );
    const after = cursor.decode(q.cursor, z.strictObject({ t: cursor.pgTimestampText, id: cursor.uuidText }));
    const projectId = q.project ? (await projectBySlug(q.project)).id : null;
    await loadIssue(id, projectId);

    const params = [id];
    let sql = `SELECT e.*, e.occurred_at::text AS cursor_value FROM error_events e
                WHERE e.issue_id = $1 AND e.project_id = (SELECT project_id FROM issues WHERE id = $1)`;
    if (after) {
      params.push(after.t, after.id);
      sql += ` AND (e.occurred_at, e.event_id) < ($2::timestamptz, $3::uuid)`;
    }
    params.push(q.limit + 1);
    sql += ` ORDER BY e.occurred_at DESC, e.event_id DESC LIMIT $${params.length}`;

    const { rows } = await pool.query(sql, params);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    res.json({
      events: page.map(serialize.event),
      next_cursor: rows.length > q.limit ? cursor.encode({ t: last.cursor_value, id: last.event_id }) : null,
    });
  }));

  router.patch('/issues/:id', requireAdmin, asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const projectId = await optionalProjectId(req.query);
    const body = z.strictObject({ status: z.enum(['unresolved', 'resolved', 'ignored']) }).safeParse(req.body);
    if (!body.success) throw new ApiError('VALIDATION_ERROR', 'Body must be { status: "unresolved" | "resolved" | "ignored" }');
    const { rowCount } = await pool.query(
      `UPDATE issues
          SET status = $2,
              resolved_at = CASE WHEN $2 = 'resolved' THEN coalesce(resolved_at, now()) ELSE NULL END,
              -- Audit trail: only a real change replaces who/when.
              status_changed_at = CASE WHEN status IS DISTINCT FROM $2 THEN now() ELSE status_changed_at END,
              status_changed_by = CASE WHEN status IS DISTINCT FROM $2 THEN $4::int ELSE status_changed_by END
        WHERE id = $1 AND ($3::int IS NULL OR project_id = $3)`,
      [id, body.data.status, projectId, req.user.id],
    );
    if (rowCount === 0) throw new ApiError('NOT_FOUND', 'Issue not found');
    res.json({ issue: serialize.issue(await loadIssue(id, projectId)) });
  }));

  const ALERT_SELECT = `SELECT a.id, a.kind, a.issue_id, i.title AS issue_title, a.details, a.created_at, a.acknowledged_at
                          FROM issue_alerts a JOIN issues i ON i.id = a.issue_id`;

  router.get('/alerts', asyncRoute(async (req, res) => {
    const q = parseQuery(
      z.strictObject({ project: slug, acknowledged: z.enum(['true', 'false']).optional() }),
      req.query,
    );
    const project = await projectBySlug(q.project);
    const ack = q.acknowledged === undefined ? null : q.acknowledged === 'true';
    const { rows } = await pool.query(
      `${ALERT_SELECT}
        WHERE a.project_id = $1
          AND ($2::boolean IS NULL OR (a.acknowledged_at IS NOT NULL) = $2)
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 200`,
      [project.id, ack],
    );
    res.json({ alerts: rows.map(serialize.alert) });
  }));

  router.post('/alerts/:id/ack', requireAdmin, asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const projectId = await optionalProjectId(req.query);
    if (!z.strictObject({}).safeParse(req.body).success) throw new ApiError('VALIDATION_ERROR', 'Body must be {}');
    // Already-acknowledged alerts keep their original time and user.
    await pool.query(
      `UPDATE issue_alerts SET acknowledged_at = now(), acknowledged_by = $2
        WHERE id = $1 AND acknowledged_at IS NULL AND ($3::int IS NULL OR project_id = $3)`,
      [id, req.user.id, projectId],
    );
    const { rows } = await pool.query(
      `${ALERT_SELECT} WHERE a.id = $1 AND ($2::int IS NULL OR a.project_id = $2)`,
      [id, projectId],
    );
    if (!rows[0]) throw new ApiError('NOT_FOUND', 'Alert not found');
    res.json({ alert: serialize.alert(rows[0]) });
  }));

  return router;
}

module.exports = { createDashboardRouter };
