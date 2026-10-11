// ML is shadow-only (CLAUDE.md rule 5): the score is stored for comparison and never read by
// the alert rules. Any failure yields nulls and processing carries on.

const NONE = Object.freeze({ ml_score: null, ml_model_version: null });

function createMlShadow(mlConfig, { fetchImpl = fetch, log = () => {} } = {}) {
  if (!mlConfig.enabled) return async () => NONE;
  const url = new URL('/score', mlConfig.url).toString();

  return async function scoreEvent(projectId, event) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The fields the ML engine's /score endpoint understands. The event is already scrubbed.
        body: JSON.stringify({
          service: `project-${projectId}-${event.source}`,
          level: event.level.toUpperCase(),
          message: event.message,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(mlConfig.timeoutMs), // also bounds reading the body
      });
      if (!res.ok) {
        log('ml_shadow_failed', { reason: `status ${res.status}` });
        return NONE;
      }
      const body = await res.json();
      const score = body && body.anomaly_score;
      // ml_score is a Postgres REAL; a value outside its range would fail the whole insert.
      if (typeof score !== 'number' || !Number.isFinite(score) || Math.abs(score) > 1e30) {
        log('ml_shadow_failed', { reason: 'bad response' });
        return NONE;
      }
      return { ml_score: score, ml_model_version: mlConfig.modelVersion };
    } catch (err) {
      log('ml_shadow_failed', { reason: err && err.name === 'TimeoutError' ? 'timeout' : 'error' });
      return NONE;
    }
  };
}

module.exports = { createMlShadow, NONE };
