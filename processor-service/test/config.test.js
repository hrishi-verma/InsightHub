import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadConfig } = require('../src/config');

const base = { KAFKA_BROKER: 'localhost:9093', DB_HOST: 'localhost', DB_PASSWORD: 'not-a-real-password' };

describe('loadConfig', () => {
  it('uses the contract defaults', () => {
    const c = loadConfig(base);
    expect(c.rules).toEqual({
      spikeMinCount: 10, spikeMultiplier: 5, spikeWindowMinutes: 5, spikeBaselineHours: 24, spikeCooldownMinutes: 60,
    });
    expect(c.kafka.errorGroup).toBe('error-processors');
    expect(c.ml).toMatchObject({ enabled: false, timeoutMs: 500, modelVersion: 'synthetic-v0' });
  });

  it('fails closed without a DB password, host or broker (and never echoes values)', () => {
    for (const key of Object.keys(base)) {
      expect(() => loadConfig({ ...base, [key]: undefined })).toThrow(key);
      expect(() => loadConfig({ ...base, [key]: '' })).toThrow(key);
    }
    try {
      loadConfig({ ...base, DB_PORT: 'nope' });
    } catch (err) {
      expect(err.message).not.toContain('not-a-real-password');
    }
  });

  it('rejects bad values', () => {
    expect(() => loadConfig({ ...base, ALERT_SPIKE_MIN_COUNT: '0' })).toThrow();
    expect(() => loadConfig({ ...base, ML_SHADOW: 'yes' })).toThrow();
    expect(() => loadConfig({ ...base, ML_SHADOW: 'on' })).toThrow('ML_ENGINE_URL');
    expect(() => loadConfig({ ...base, ML_SHADOW: 'on', ML_ENGINE_URL: 'file:///etc/passwd' })).toThrow();
  });

  it('reads thresholds from env', () => {
    const c = loadConfig({ ...base, ALERT_SPIKE_MIN_COUNT: '3', ALERT_SPIKE_COOLDOWN_MINUTES: '15' });
    expect(c.rules.spikeMinCount).toBe(3);
    expect(c.rules.spikeCooldownMinutes).toBe(15);
  });
});

describe('loadConfig: notifications and DLQ', () => {
  const smtp = { SMTP_HOST: 'smtp.example.com', NOTIFY_EMAIL_FROM: 'alerts@example.com', NOTIFY_EMAIL_TO: 'a@example.com, b@example.com' };

  it('is all off by default, DLQ on', () => {
    const c = loadConfig(base);
    expect(c.notify).toMatchObject({ webhookUrl: null, email: null, dashboardUrl: null, maxPerHour: 20, timeoutMs: 5000 });
    expect(c.dlq).toMatchObject({ enabled: true, topic: 'error-events-dlq' });
    expect(loadConfig({ ...base, DLQ: 'off', DLQ_TOPIC: 'x.dead' }).dlq).toMatchObject({ enabled: false, topic: 'x.dead' });
  });

  it('accepts a complete email setup', () => {
    const c = loadConfig({ ...base, ...smtp, SMTP_USER: 'u', SMTP_PASSWORD: 'p', SMTP_SECURE: 'on' });
    expect(c.notify.email).toMatchObject({ host: 'smtp.example.com', port: 587, secure: true, to: ['a@example.com', 'b@example.com'] });
  });

  it('rejects half-configured email', () => {
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.com' })).toThrow('NOTIFY_EMAIL_FROM');
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', NOTIFY_EMAIL_FROM: 'a@example.com' })).toThrow('NOTIFY_EMAIL_TO');
    expect(() => loadConfig({ ...base, NOTIFY_EMAIL_TO: 'a@example.com' })).toThrow('SMTP_HOST');
    expect(() => loadConfig({ ...base, ...smtp, SMTP_USER: 'u' })).toThrow('SMTP_PASSWORD');
  });

  it('validates recipients without echoing them', () => {
    const many = Array.from({ length: 11 }, (_, i) => `u${i}@example.com`).join(',');
    expect(() => loadConfig({ ...base, ...smtp, NOTIFY_EMAIL_TO: many })).toThrow('1 to 10');
    expect(() => loadConfig({ ...base, ...smtp, NOTIFY_EMAIL_TO: 'ok@example.com,not-an-email' })).toThrow('invalid address');
    try {
      loadConfig({ ...base, ...smtp, NOTIFY_EMAIL_TO: 'secret-person@example.com,bad' });
    } catch (err) {
      expect(err.message).not.toContain('secret-person');
    }
  });

  it('enforces https for the webhook and dashboard URL (http only for localhost)', () => {
    expect(loadConfig({ ...base, NOTIFY_WEBHOOK_URL: 'https://hooks.example.com/x' }).notify.webhookUrl).toBe('https://hooks.example.com/x');
    expect(loadConfig({ ...base, NOTIFY_WEBHOOK_URL: 'http://127.0.0.1:9/hook' }).notify.webhookUrl).toBeTruthy();
    expect(loadConfig({ ...base, DASHBOARD_URL: 'http://localhost:3000/' }).notify.dashboardUrl).toBe('http://localhost:3000');
    expect(() => loadConfig({ ...base, NOTIFY_WEBHOOK_URL: 'http://hooks.example.com/x' })).toThrow('NOTIFY_WEBHOOK_URL');
    expect(() => loadConfig({ ...base, NOTIFY_WEBHOOK_URL: 'https://u:p@hooks.example.com/x' })).toThrow('NOTIFY_WEBHOOK_URL');
    expect(() => loadConfig({ ...base, NOTIFY_WEBHOOK_URL: 'ftp://x' })).toThrow();
    expect(() => loadConfig({ ...base, DASHBOARD_URL: 'http://evil.example.com' })).toThrow('DASHBOARD_URL');
    try {
      loadConfig({ ...base, NOTIFY_WEBHOOK_URL: 'http://hooks.example.com/SECRETPATH' });
    } catch (err) {
      expect(err.message).not.toContain('SECRETPATH');
    }
  });
});
