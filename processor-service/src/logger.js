// One JSON line per event. Callers pass ids, codes and reasons only, never message content.
function log(event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields });
  if (/failed|invalid|error|aborted|crash/.test(event)) console.error(line);
  else console.log(line);
}

module.exports = { log };
