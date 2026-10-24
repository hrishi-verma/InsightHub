import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import helpers from './helpers.js';

const { buildApp, resetDb, createUser, getPool, closePool, sessionCookie, DASHBOARD } = helpers;

const PASSWORD = 'correct horse battery staple';
const fp = (n) => crypto.createHash('sha256').update(String(n)).digest('hex');

let projects;
let issueIds; // in education-enlightened, newest last_seen first
let otherIssueId;
let alertIds;

async function insertIssue(projectId, n, { status = 'unresolved', source = 'server', count = 1, minutesAgo = n, title } = {}) {
  const { rows } = await getPool().query(
    `INSERT INTO issues (project_id, fingerprint, source, error_type, title, culprit, status, first_seen, last_seen, event_count)
     VALUES ($1, $2, $3, 'TypeError', $4, 'f (a.js)', $5, now() - interval '2 hours', now() - $6 * interval '1 minute', $7)
     RETURNING id`,
    [projectId, fp(`${projectId}-${n}`), source, title ?? `TypeError: issue ${n}`, status, minutesAgo, count],
  );
  return Number(rows[0].id);
}

async function insertEvent(projectId, issueId, { minutesAgo = 1, environment = 'production', source = 'server' } = {}) {
  await getPool().query(
    `INSERT INTO error_events (event_id, occurred_at, received_at, project_id, issue_id, source, environment, level,
                               error_type, message, http_method, http_status, tags)
     VALUES ($1, now() - $2 * interval '1 minute', now(), $3, $4, $5, $6, 'error', 'TypeError', 'boom', 'GET', 500, '{"k":"v"}')`,
    [crypto.randomUUID(), minutesAgo, projectId, issueId, source, environment],
  );
}

beforeEach(async () => {
  projects = await resetDb();
  const ee = projects['education-enlightened'];
  await createUser('admin@example.com', PASSWORD, 'admin');
  await createUser('viewer@example.com', PASSWORD, 'viewer');

  issueIds = [];
  for (let n = 1; n <= 7; n++) {
    issueIds.push(await insertIssue(ee, n, {
      status: n === 7 ? 'resolved' : 'unresolved',
      source: n % 2 ? 'server' : 'browser',
      count: n * 10,
      title: n === 3 ? 'TypeError: 100%_done failed' : undefined,
    }));
  }
  for (let i = 0; i < 5; i++) await insertEvent(ee, issueIds[0], { minutesAgo: i + 1 });
  await insertEvent(ee, issueIds[1], { environment: 'preview', source: 'browser' });
  otherIssueId = await insertIssue(projects['other-project'], 1);
  await insertEvent(projects['other-project'], otherIssueId);

  const { rows } = await getPool().query(
    `INSERT INTO issue_alerts (project_id, issue_id, kind, details) VALUES
       ($1, $2, 'new_issue', '{}'), ($1, $3, 'spike', '{"count": 12}'), ($4, $5, 'new_issue', '{}')
     RETURNING id`,
    [ee, issueIds[0], issueIds[1], projects['other-project'], otherIssueId],
  );
  alertIds = rows.map((r) => Number(r.id));
});
afterAll(closePool);

async function loggedIn(role = 'admin') {
  const built = buildApp();
  const res = await request(built.app).post('/api/v1/auth/login').set('Origin', DASHBOARD).set('Content-Type', 'application/json')
    .send({ email: `${role}@example.com`, password: PASSWORD });
  const cookie = sessionCookie(res);
  const get = (url) => request(built.app).get(url).set('Cookie', cookie);
  const send = (method, url, body) =>
    request(built.app)[method](url).set('Cookie', cookie).set('Origin', DASHBOARD).set('Content-Type', 'application/json').send(body);
  return { get, send, app: built.app };
}

describe('read API requires a session', () => {
  it.each(['/api/v1/projects', '/api/v1/overview?project=education-enlightened', '/api/v1/issues?project=education-enlightened', '/api/v1/alerts?project=education-enlightened'])(
    '%s → 401 without a cookie',
    async (url) => {
      const { app } = buildApp();
      expect((await request(app).get(url)).status).toBe(401);
    },
  );
});

describe('projects and overview', () => {
  it('lists projects', async () => {
    const { get } = await loggedIn('viewer');
    const res = await get('/api/v1/projects');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.projects.map((p) => p.slug)).toEqual(['education-enlightened', 'other-project']);
  });

  it('returns overview numbers for one project only', async () => {
    const { get } = await loggedIn('viewer');
    const res = await get('/api/v1/overview?project=education-enlightened&hours=24');
    expect(res.status).toBe(200);
    expect(res.body.events_total).toBe(6);
    expect(res.body.unresolved_issues).toBe(6);
    expect(res.body.new_issues).toBe(7);
    expect(res.body.open_alerts).toBe(2);
    expect(res.body.hourly).toHaveLength(24);
    const sum = res.body.hourly.reduce((a, h) => a + h.browser + h.server, 0);
    expect(sum).toBe(6);
    expect(res.body.top_issues[0].id).toBe(issueIds[0]);
    expect(res.body.top_issues[0].project).toBe('education-enlightened');
  });

  it('validates hours and unknown projects', async () => {
    const { get } = await loggedIn('viewer');
    expect((await get('/api/v1/overview?project=education-enlightened&hours=169')).status).toBe(400);
    expect((await get('/api/v1/overview?project=education-enlightened&hours=0')).status).toBe(400);
    expect((await get('/api/v1/overview?project=nope')).status).toBe(404);
    expect((await get('/api/v1/overview')).status).toBe(400);
    expect((await get('/api/v1/overview?project=education-enlightened&evil=1')).status).toBe(400);
  });
});

describe('issues list', () => {
  it('paginates with opaque cursors without gaps or repeats', async () => {
    const { get } = await loggedIn('viewer');
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const res = await get(`/api/v1/issues?project=education-enlightened&limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.issues.map((i) => i.id));
      cursor = res.body.next_cursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(issueIds);
  });

  it('sorts by event_count and paginates that sort too', async () => {
    const { get } = await loggedIn('viewer');
    const first = await get('/api/v1/issues?project=education-enlightened&sort=event_count&limit=4');
    expect(first.body.issues.map((i) => i.event_count)).toEqual([70, 60, 50, 40]);
    const second = await get(`/api/v1/issues?project=education-enlightened&sort=event_count&limit=4&cursor=${first.body.next_cursor}`);
    expect(second.body.issues.map((i) => i.event_count)).toEqual([30, 20, 10]);
    expect(second.body.next_cursor).toBeNull();
  });

  it('filters by status, source, environment and title search', async () => {
    const { get } = await loggedIn('viewer');
    const base = '/api/v1/issues?project=education-enlightened';
    expect((await get(`${base}&status=resolved`)).body.issues.map((i) => i.id)).toEqual([issueIds[6]]);
    expect((await get(`${base}&source=browser`)).body.issues).toHaveLength(3);
    expect((await get(`${base}&environment=preview`)).body.issues.map((i) => i.id)).toEqual([issueIds[1]]);
    // % and _ are matched literally, not as wildcards.
    expect((await get(`${base}&q=${encodeURIComponent('100%_done')}`)).body.issues.map((i) => i.id)).toEqual([issueIds[2]]);
    expect((await get(`${base}&q=${encodeURIComponent('%')}`)).body.issues.map((i) => i.id)).toEqual([issueIds[2]]);
  });

  it('never returns another project\'s issues', async () => {
    const { get } = await loggedIn('viewer');
    const res = await get('/api/v1/issues?project=education-enlightened&limit=100');
    expect(res.body.issues.map((i) => i.id)).not.toContain(otherIssueId);
  });

  it('rejects bad parameters', async () => {
    const { get } = await loggedIn('viewer');
    const base = '/api/v1/issues?project=education-enlightened';
    for (const qs of ['&limit=0', '&limit=101', '&sort=title', '&status=open', '&cursor=garbage!', `&q=${'a'.repeat(201)}`, '&status=resolved&status=ignored']) {
      expect((await get(base + qs)).status).toBe(400);
    }
    // A cursor from one sort can't be replayed against another.
    const first = await get(`${base}&limit=1`);
    expect((await get(`${base}&sort=event_count&cursor=${first.body.next_cursor}`)).status).toBe(400);
    // Tampered cursor contents are rejected, not passed to SQL.
    const forged = Buffer.from(JSON.stringify({ s: 'last_seen', v: "now()'; DROP TABLE issues; --", id: '1' })).toString('base64url');
    expect((await get(`${base}&cursor=${forged}`)).status).toBe(400);
  });
});

describe('issue detail and events', () => {
  it('returns an issue with 24 hourly buckets', async () => {
    const { get } = await loggedIn('viewer');
    const res = await get(`/api/v1/issues/${issueIds[0]}`);
    expect(res.status).toBe(200);
    expect(res.body.issue).toMatchObject({ id: issueIds[0], project: 'education-enlightened', status: 'unresolved', event_count: 10 });
    expect(Object.keys(res.body.issue).sort()).toEqual(
      ['culprit', 'error_type', 'event_count', 'fingerprint', 'first_seen', 'id', 'last_release', 'last_seen', 'project', 'source', 'status', 'status_changed_at', 'status_changed_by', 'title'],
    );
    expect(res.body.hourly).toHaveLength(24);
    expect(res.body.hourly.reduce((a, h) => a + h.count, 0)).toBe(5);
  });

  it('returns 404 for another project\'s issue when scoped, and for unknown or malformed ids', async () => {
    const { get } = await loggedIn('viewer');
    expect((await get(`/api/v1/issues/${otherIssueId}?project=education-enlightened`)).status).toBe(404);
    expect((await get(`/api/v1/issues/${otherIssueId}/events?project=education-enlightened`)).status).toBe(404);
    expect((await get('/api/v1/issues/999999')).status).toBe(404);
    expect((await get('/api/v1/issues/1%20OR%201=1')).status).toBe(404);
    expect((await get('/api/v1/issues/-1')).status).toBe(404);
  });

  it('paginates events newest first', async () => {
    const { get } = await loggedIn('viewer');
    const first = await get(`/api/v1/issues/${issueIds[0]}/events?limit=3`);
    expect(first.status).toBe(200);
    expect(first.body.events).toHaveLength(3);
    const ev = first.body.events[0];
    expect(ev).toMatchObject({ source: 'server', http: { method: 'GET', status: 500 }, tags: { k: 'v' }, ml_score: null });
    expect(ev.received_at).toMatch(/Z$/);
    const second = await get(`/api/v1/issues/${issueIds[0]}/events?limit=3&cursor=${first.body.next_cursor}`);
    expect(second.body.events).toHaveLength(2);
    expect(second.body.next_cursor).toBeNull();
    const all = [...first.body.events, ...second.body.events].map((e) => e.occurred_at);
    expect(all).toEqual([...all].sort().reverse());
    expect(new Set(all).size).toBe(5);
  });
});

describe('admin-only changes', () => {
  it('viewer cannot PATCH an issue (403)', async () => {
    const { send } = await loggedIn('viewer');
    const res = await send('patch', `/api/v1/issues/${issueIds[0]}`, { status: 'resolved' });
    expect(res.status).toBe(403);
    const { rows } = await getPool().query('SELECT status FROM issues WHERE id = $1', [issueIds[0]]);
    expect(rows[0].status).toBe('unresolved');
  });

  it('admin can resolve and reopen an issue', async () => {
    const { send } = await loggedIn('admin');
    const resolved = await send('patch', `/api/v1/issues/${issueIds[0]}`, { status: 'resolved' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.issue.status).toBe('resolved');
    let { rows } = await getPool().query('SELECT resolved_at FROM issues WHERE id = $1', [issueIds[0]]);
    expect(rows[0].resolved_at).not.toBeNull();

    await send('patch', `/api/v1/issues/${issueIds[0]}`, { status: 'unresolved' });
    ({ rows } = await getPool().query('SELECT resolved_at FROM issues WHERE id = $1', [issueIds[0]]));
    expect(rows[0].resolved_at).toBeNull();
  });

  it('records who changed the status and when, and leaves it alone on a same-status PATCH', async () => {
    const { send, get } = await loggedIn('admin');
    const before = await get(`/api/v1/issues/${issueIds[0]}`);
    expect(before.body.issue.status_changed_at).toBeNull();
    expect(before.body.issue.status_changed_by).toBeNull();

    const res = await send('patch', `/api/v1/issues/${issueIds[0]}`, { status: 'resolved' });
    expect(res.body.issue.status_changed_by).toBe('admin@example.com');
    const changedAt = res.body.issue.status_changed_at;
    expect(new Date(changedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    // Same status again must not overwrite the earlier change.
    const again = await send('patch', `/api/v1/issues/${issueIds[0]}`, { status: 'resolved' });
    expect(again.status).toBe(200);
    expect(again.body.issue.status_changed_at).toBe(changedAt);
    expect(again.body.issue.status_changed_by).toBe('admin@example.com');

    const list = await get('/api/v1/issues?project=education-enlightened');
    const listed = list.body.issues.find((i) => i.id === issueIds[0]);
    expect(listed.status_changed_by).toBe('admin@example.com');
  });

  it('keeps the timestamp but clears the email if the user is deleted', async () => {
    const admin = await loggedIn('admin');
    await admin.send('patch', `/api/v1/issues/${issueIds[0]}`, { status: 'ignored' });
    await getPool().query(`UPDATE issues SET status_changed_by = (SELECT id FROM users WHERE email = 'viewer@example.com') WHERE id = $1`, [issueIds[0]]);
    await getPool().query(`DELETE FROM users WHERE email = 'viewer@example.com'`);
    const res = await admin.get(`/api/v1/issues/${issueIds[0]}`);
    expect(res.body.issue.status_changed_by).toBeNull();
    expect(res.body.issue.status_changed_at).not.toBeNull();
  });

  it('rejects bad PATCH bodies and PATCH without Origin', async () => {
    const { send, app } = await loggedIn('admin');
    expect((await send('patch', `/api/v1/issues/${issueIds[0]}`, { status: 'closed' })).status).toBe(400);
    expect((await send('patch', `/api/v1/issues/${issueIds[0]}`, { status: 'resolved', event_count: 0 })).status).toBe(400);
    expect((await send('patch', `/api/v1/issues/${otherIssueId}?project=education-enlightened`, { status: 'resolved' })).status).toBe(404);
    const noOrigin = await request(app).patch(`/api/v1/issues/${issueIds[0]}`).set('Content-Type', 'application/json').send({ status: 'resolved' });
    expect(noOrigin.status).toBe(403);
  });

  it('lists alerts and lets admins acknowledge them', async () => {
    const viewer = await loggedIn('viewer');
    const list = await viewer.get('/api/v1/alerts?project=education-enlightened&acknowledged=false');
    expect(list.status).toBe(200);
    expect(list.body.alerts).toHaveLength(2);
    expect(list.body.alerts[0]).toHaveProperty('issue.title');
    expect((await viewer.send('post', `/api/v1/alerts/${alertIds[0]}/ack`, {})).status).toBe(403);

    const admin = await loggedIn('admin');
    const ack = await admin.send('post', `/api/v1/alerts/${alertIds[0]}/ack`, {});
    expect(ack.status).toBe(200);
    expect(ack.body.alert.acknowledged_at).not.toBeNull();
    expect((await viewer.get('/api/v1/alerts?project=education-enlightened&acknowledged=false')).body.alerts).toHaveLength(1);
    expect((await viewer.get('/api/v1/alerts?project=education-enlightened&acknowledged=true')).body.alerts).toHaveLength(1);

    expect((await admin.send('post', `/api/v1/alerts/${alertIds[0]}/ack`, { extra: 1 })).status).toBe(400);
    expect((await admin.send('post', `/api/v1/alerts/${alertIds[2]}/ack?project=education-enlightened`, {})).status).toBe(404);
    expect((await admin.send('post', '/api/v1/alerts/424242/ack', {})).status).toBe(404);
  });
});

describe('hardening', () => {
  it('returns JSON 404s and security headers', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('health checks the database', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
