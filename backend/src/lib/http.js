// Small request helpers shared by middleware.

// Media type from Content-Type, without parameters. Works even when the body is empty
// (req.is() returns null then).
function mediaType(req) {
  const ct = req.get('Content-Type');
  return ct ? ct.split(';')[0].trim().toLowerCase() : '';
}

const isJson = (req) => mediaType(req) === 'application/json';

function readCookie(req, name) {
  const header = req.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

module.exports = { isJson, readCookie };
