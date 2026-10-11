import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/index.js';
import helpers from './helpers.js';

const { testEnv } = helpers;

describe('config', () => {
  it('loads a valid config', () => {
    const config = loadConfig(testEnv());
    expect(config.dashboardOrigins).toEqual(['http://localhost:3000']);
    expect(config.serviceToken).toBeNull();
  });

  it.each([
    ['DASHBOARD_ORIGINS=*', { DASHBOARD_ORIGINS: '*' }],
    ['wildcard subdomain origin', { DASHBOARD_ORIGINS: 'https://*.example.com' }],
    ['missing DASHBOARD_ORIGINS', { DASHBOARD_ORIGINS: '' }],
    ['origin with a path', { DASHBOARD_ORIGINS: 'https://a.example/path' }],
    ['http origin in production', { NODE_ENV: 'production', DASHBOARD_ORIGINS: 'http://a.example' }],
    ['missing NODE_ENV', { NODE_ENV: undefined }],
    ['missing KAFKA_BROKER', { KAFKA_BROKER: undefined }],
    ['missing DB password', { DB_PASSWORD: undefined }],
    ['TRUST_PROXY=true', { TRUST_PROXY: 'true' }],
    ['short SERVICE_TOKEN', { SERVICE_TOKEN: 'dev-token-123' }],
    ['bad PORT', { PORT: 'abc' }],
  ])('refuses to start with %s', (_name, overrides) => {
    expect(() => loadConfig(testEnv(overrides))).toThrow(/Invalid configuration/);
  });

  it('never puts secret values in the error message', () => {
    const secret = 'super-secret-token';
    let message = '';
    try {
      loadConfig(testEnv({ SERVICE_TOKEN: secret }));
    } catch (err) {
      message = err.message;
    }
    expect(message).toMatch(/SERVICE_TOKEN/);
    expect(message).not.toContain(secret);
  });

  it('accepts https origins in production and proxy hop counts', () => {
    const config = loadConfig(testEnv({ NODE_ENV: 'production', DASHBOARD_ORIGINS: 'https://a.example,https://b.example', TRUST_PROXY: '1' }));
    expect(config.dashboardOrigins).toHaveLength(2);
    expect(config.trustProxy).toBe(1);
  });
});
