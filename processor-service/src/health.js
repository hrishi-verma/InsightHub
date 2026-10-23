const http = require('node:http');

const CHECK_TIMEOUT_MS = 2000;
const CACHE_MS = 5000;
const REQUEST_TIMEOUT_MS = 5000;
const CLOSE_TIMEOUT_MS = 2000;
const STARTUP_GRACE_MS = 60000; // joining the group takes a while

/** Counters since start. Numbers and timestamps only; never message content, ids or errors. */
function createMetrics(now = () => Date.now()) {
  const startedAt = now();
  const m = { stored: 0, duplicate: 0, invalid: 0, failed: 0, retries: 0, alerts_raised: 0, lastEventAt: null };
  return {
    // Feed it every processMessage result.
    record(result) {
      const status = result && result.status;
      if (status === 'stored' || status === 'duplicate' || status === 'invalid' || status === 'failed') {
        m[status] += 1;
        m.lastEventAt = now();
      }
      if (status === 'stored' && Array.isArray(result.alerts)) m.alerts_raised += result.alerts.length;
    },
    retry() { m.retries += 1; },
    snapshot() {
      return {
        stored: m.stored, duplicate: m.duplicate, invalid: m.invalid, failed: m.failed,
        retries: m.retries, alerts_raised: m.alerts_raised,
        started_at: new Date(startedAt).toISOString(),
        last_event_at: m.lastEventAt === null ? null : new Date(m.lastEventAt).toISOString(),
        uptime_s: Math.floor((now() - startedAt) / 1000),
      };
    },
  };
}

// Runs a check with a hard timeout; any throw or timeout means "down". Errors are never surfaced.
function runWithTimeout(check, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    Promise.resolve()
      .then(check)
      .then(() => resolve(true), () => resolve(false))
      .finally(() => clearTimeout(timer));
  });
}

// Caches the result (and shares the in-flight run) so request floods can't hammer the dependency.
function cachedCheck(check, { timeoutMs, cacheMs, now }) {
  let at = -Infinity;
  let pending = null;
  let last = false;
  return () => {
    if (pending) return pending;
    if (now() - at < cacheMs) return Promise.resolve(last);
    pending = runWithTimeout(check, timeoutMs).then((ok) => {
      last = ok;
      at = now();
      pending = null;
      return ok;
    });
    return pending;
  };
}

function createHealthServer({
  host, port, checkDb, checkKafka, checkConsumer = () => {}, metrics, log,
  startupGraceMs = STARTUP_GRACE_MS, timeoutMs = CHECK_TIMEOUT_MS, cacheMs = CACHE_MS, now = () => Date.now(),
}) {
  const db = cachedCheck(checkDb, { timeoutMs, cacheMs, now });
  const kafka = cachedCheck(checkKafka, { timeoutMs, cacheMs, now });
  const startedAt = now();
  // Up during the grace period; after it the consumer must hold at least one partition.
  const consumer = cachedCheck(() => {
    if (now() - startedAt < startupGraceMs) return;
    return Promise.resolve(checkConsumer()).then((ok) => { if (ok === false) throw new Error('no assignment'); });
  }, { timeoutMs, cacheMs, now });

  function send(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Connection: 'close', // request bodies are never read, so don't keep the socket
    });
    res.end(text);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const path = (req.url || '').split('?')[0];
      if (path !== '/health' && path !== '/metrics') return send(res, 404, { error: 'not_found' });
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return send(res, 405, { error: 'method_not_allowed' });
      }
      if (path === '/metrics') return send(res, 200, metrics.snapshot());
      const [dbOk, kafkaOk, consumerOk] = await Promise.all([db(), kafka(), consumer()]);
      const ok = dbOk && kafkaOk && consumerOk;
      return send(res, ok ? 200 : 503, {
        status: ok ? 'ok' : 'degraded',
        db: dbOk ? 'up' : 'down',
        kafka: kafkaOk ? 'up' : 'down',
        consumer: consumerOk ? 'up' : 'down',
      });
    } catch {
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    }
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = 1000;

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          server.on('error', (err) => log('health_server_error', { code: err && err.code }));
          resolve();
        });
      });
    },
    // Bounded: stragglers are cut off after CLOSE_TIMEOUT_MS.
    close() {
      return new Promise((resolve) => {
        const timer = setTimeout(() => { server.closeAllConnections(); resolve(); }, CLOSE_TIMEOUT_MS);
        timer.unref();
        server.close(() => { clearTimeout(timer); resolve(); });
        server.closeIdleConnections();
      });
    },
  };
}

module.exports = { createHealthServer, createMetrics };
