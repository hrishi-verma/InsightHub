// Glue around the processor: counts results and sends notifications. Kept out of index.js so it
// can be tested with fakes.

/**
 * Notifications go out only for a stored result that raised alerts, i.e. after the DB
 * transaction committed. Duplicates, invalid and failed messages never notify.
 */
function createPipeline({ rawProcess, metrics, notifier }) {
  return async function processMessage(...args) {
    const result = await rawProcess(...args);
    metrics.record(result);
    if (result && result.status === 'stored' && result.alerts && result.alerts.length > 0) {
      notifier.notify(result); // never throws, never awaited
    }
    return result;
  };
}

module.exports = { createPipeline };
