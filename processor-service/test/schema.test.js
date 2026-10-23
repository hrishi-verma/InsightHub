import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseMessage } = require('../src/schema');
const { makeEvent, kafkaMessage } = require('./helpers');

const parse = (m) => parseMessage(m, { maxBytes: 65536 });
const raw = (obj, key = '1') => ({ key: Buffer.from(key), value: Buffer.from(JSON.stringify(obj)) });
const envelope = (event, extra = {}) => ({ schema: 1, project_id: 1, received_at: new Date().toISOString(), event, ...extra });

describe('parseMessage', () => {
  it('accepts a valid message', () => {
    const r = parse(kafkaMessage(1, makeEvent({ tags: { 'feature.flag': 'on' } })));
    expect(r.ok).toBe(true);
  });

  const rejects = {
    'not JSON': { key: Buffer.from('1'), value: Buffer.from('{oops') },
    'null value': { key: null, value: null },
    'oversized': { key: null, value: Buffer.alloc(70000, 'a') },
    'extra event field': raw(envelope(makeEvent({ email: 'a@b.com' }))),
    'extra envelope field': raw(envelope(makeEvent(), { cookies: 'x' })),
    'extra http field': raw(envelope(makeEvent({ http: { method: 'GET', headers: {} } }))),
    'wrong schema version': raw(envelope(makeEvent(), { schema: 2 })),
    'non-v4 uuid': raw(envelope(makeEvent({ event_id: '9b2f7c1e-3a4d-1e8f-9c1a-2b3c4d5e6f70' }))),
    'timestamp without timezone': raw(envelope(makeEvent({ occurred_at: '2026-10-11T09:30:00' }))),
    'occurred_at too old': raw(envelope(makeEvent({ occurred_at: new Date(Date.now() - 8 * 86400000).toISOString() }))),
    'occurred_at in the future': raw(envelope(makeEvent({ occurred_at: new Date(Date.now() + 10 * 60000).toISOString() }))),
    'received_at in the future': raw(envelope(makeEvent(), { received_at: new Date(Date.now() + 3600000).toISOString() })),
    'bad enum': raw(envelope(makeEvent({ level: 'info' }))),
    'message too long': raw(envelope(makeEvent({ message: 'x'.repeat(1001) }))),
    'empty message': raw(envelope(makeEvent({ message: '' }))),
    'stack too long': raw(envelope(makeEvent({ stack: 'x'.repeat(16001) }))),
    'NUL in message': raw(envelope(makeEvent({ message: 'a\u0000b' }))),
    'query string in url_path': raw(envelope(makeEvent({ url_path: '/x?token=abc' }))),
    'fragment in url_path': raw(envelope(makeEvent({ url_path: '/x#y' }))),
    'relative url_path': raw(envelope(makeEvent({ url_path: 'x' }))),
    'bad release': raw(envelope(makeEvent({ release: 'a b' }))),
    'http on browser event': raw(envelope(makeEvent({ source: 'browser' }))),
    'too many tags': raw(envelope(makeEvent({ tags: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`t${i}`, 'v'])) }))),
    'bad tag key': raw(envelope(makeEvent({ tags: { 'Bad Key': 'v' } }))),
    'non-string tag value': raw(envelope(makeEvent({ tags: { a: 1 } }))),
    '__proto__ tag': { key: Buffer.from('1'), value: Buffer.from(JSON.stringify(envelope(makeEvent())).replace('"event":{', '"event":{"tags":{"__proto__":"x"},')) },
    'null optional field': raw(envelope(makeEvent({ stack: null }))),
    'project_id as string': raw(envelope(makeEvent(), { project_id: '1' })),
    'key does not match project': raw(envelope(makeEvent()), '2'),
    'missing key': { key: null, value: Buffer.from(JSON.stringify(envelope(makeEvent()))) },
    'empty key': raw(envelope(makeEvent()), ''),
    'non-numeric key': raw(envelope(makeEvent()), 'abc'),
    'leading-zero key': raw(envelope(makeEvent()), '01'),
    'array root': { key: null, value: Buffer.from('[]') },
  };

  for (const [name, message] of Object.entries(rejects)) {
    it(`rejects: ${name}`, () => {
      let r;
      expect(() => { r = parse(message); }).not.toThrow();
      expect(r.ok).toBe(false);
      expect(typeof r.reason).toBe('string');
    });
  }

  it('accepts a decimal key equal to project_id', () => {
    expect(parse(raw(envelope(makeEvent(), { project_id: 42 }), '42')).ok).toBe(true);
  });

  it('never puts message content in the reason', () => {
    const secretish = 'SENSITIVE-VALUE-123';
    const r = parse(raw(envelope(makeEvent({ level: secretish, [secretish]: secretish }))));
    expect(r.ok).toBe(false);
    expect(r.reason).not.toContain('SENSITIVE');
  });
});
