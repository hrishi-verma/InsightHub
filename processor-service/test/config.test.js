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
