// The mock must follow contract §4 shapes and rules, or the pages will break on the real API.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEndpoints } from '../lib/http.js';
import { createMockRequest, resetMock } from '../lib/mock.js';

const api = createEndpoints(createMockRequest({ latencyMs: 0 }));
const P = 'education-enlightened';
const ISSUE_KEYS = ['culprit', 'error_type', 'event_count', 'fingerprint', 'first_seen', 'id', 'last_release', 'last_seen', 'project', 'source', 'status', 'title'];

beforeEach(() => resetMock());

test('everything but login requires a session', async () => {
  await assert.rejects(api.me(), (e) => e.status === 401);
  await assert.rejects(api.projects(), (e) => e.status === 401);
  await assert.rejects(api.login('a@b.c', 'short'), (e) => e.status === 401);
});

test('shapes match contract §4', async () => {
  const { user } = await api.login('admin@example.com', 'correct horse battery');
  assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'role']);
  const { projects } = await api.projects();
  assert.deepEqual(Object.keys(projects[0]).sort(), ['id', 'name', 'slug']);

  const o = await api.overview(P, 24);
  assert.deepEqual(Object.keys(o).sort(), ['events_total', 'hourly', 'new_issues', 'open_alerts', 'top_issues', 'unresolved_issues']);
  assert.equal(o.hourly.length, 24);
  assert.deepEqual(Object.keys(o.hourly[0]).sort(), ['browser', 'hour', 'server']);
  assert.ok(o.top_issues.length <= 5);
  assert.deepEqual(Object.keys(o.top_issues[0]).sort(), ISSUE_KEYS);

  const list = await api.issues({ project: P, limit: 10 });
  assert.equal(list.issues.length, 10);
  assert.equal(typeof list.next_cursor, 'string');
  const page2 = await api.issues({ project: P, limit: 10, cursor: list.next_cursor });
  assert.notEqual(page2.issues[0].id, list.issues[0].id);

  const detail = await api.issue(list.issues[0].id);
  assert.deepEqual(Object.keys(detail.issue).sort(), ISSUE_KEYS);
  assert.equal(detail.hourly.length, 24);
  assert.deepEqual(Object.keys(detail.hourly[0]).sort(), ['count', 'hour']);

  const ev = await api.issueEvents(list.issues[0].id, { limit: 5 });
  assert.ok(ev.events.length <= 5);
  for (const k of ['event_id', 'occurred_at', 'source', 'environment', 'level', 'error_type', 'message', 'received_at', 'ml_score', 'ml_model_version']) {
    assert.ok(k in ev.events[0], k);
  }

  const { alerts } = await api.alerts(P, false);
  assert.ok(alerts.every((a) => a.acknowledged_at === null));
  assert.deepEqual(Object.keys(alerts[0]).sort(), ['acknowledged_at', 'created_at', 'details', 'id', 'issue', 'kind']);
  assert.deepEqual(Object.keys(alerts[0].issue).sort(), ['id', 'title']);
});

test('invalid parameters are rejected like the real API', async () => {
  await api.login('admin@example.com', 'correct horse battery');
  await assert.rejects(api.overview(P, 0), (e) => e.status === 400);
  await assert.rejects(api.overview(P, 169), (e) => e.status === 400);
  await assert.rejects(api.issues({ project: P, limit: 101 }), (e) => e.status === 400);
  await assert.rejects(api.issues({ project: P, sort: 'title' }), (e) => e.status === 400);
  await assert.rejects(api.issues({ project: P, q: 'x'.repeat(201) }), (e) => e.status === 400);
  await assert.rejects(api.issues({ project: 'other' }), (e) => e.status === 404);
  await assert.rejects(api.issue('9999'), (e) => e.status === 404);
});

test('viewers cannot change issues or acknowledge alerts (403)', async () => {
  await api.login('viewer@example.com', 'correct horse battery');
  await assert.rejects(api.setIssueStatus(1, 'resolved'), (e) => e.status === 403);
  await assert.rejects(api.ackAlert(1), (e) => e.status === 403);
});

test('admins can change status and acknowledge', async () => {
  await api.login('admin@example.com', 'correct horse battery');
  assert.equal((await api.setIssueStatus(1, 'resolved')).issue.status, 'resolved');
  const { alert } = await api.ackAlert(1);
  assert.ok(alert.acknowledged_at);
  await api.logout();
  await assert.rejects(api.me(), (e) => e.status === 401);
});
