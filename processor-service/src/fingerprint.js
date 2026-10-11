const crypto = require('crypto');

// Grouping rules from contract §3 ("Fingerprint"). Changing anything here regroups every
// future event into new issues, so treat it like a schema change.

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const QUOTED = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g;
// A hex run needs at least one digit, so ordinary words like "deadbeef" style prose survive.
const HEX = /\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi;
const NUMBER = /\d+(?:\.\d+)?/g;

// Order matters: UUIDs and quoted text first (they contain numbers), then hex, then numbers.
function normalizeMessage(message) {
  return message
    .replace(UUID, '<uuid>')
    .replace(QUOTED, '<str>')
    .replace(HEX, '<hex>')
    .replace(NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// "name-HASH.ext" or "name.HASH.chunk.ext". A hash has a digit or mixed case, so
// names like "user.controller.js" are left alone.
const HASHED_NAME = /^(.*[^.-])[.-]([A-Za-z0-9_-]{8,})((?:\.chunk)?\.[A-Za-z0-9]+)$/;

function looksLikeHash(s) {
  return /\d/.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s));
}

function normalizeFile(file) {
  let f = file.trim().replace(/[?#].*$/, ''); // query string and fragment
  f = f.replace(/(?::\d+){1,2}$/, ''); // :line or :line:col
  const slash = f.lastIndexOf('/') + 1;
  const dir = f.slice(0, slash);
  const base = f.slice(slash);
  const m = HASHED_NAME.exec(base);
  if (m && looksLikeHash(m[2])) return dir + m[1] + m[3];
  return f;
}

// V8:            "    at fn (file:1:2)", "    at file:1:2", "    at async fn (file:1:2)"
// Firefox/Safari: "fn@file:1:2", "@file:1:2"
const V8_WITH_FN = /^\s*at\s+(?:async\s+)?(.*?)\s+\((.*)\)\s*$/;
const V8_NO_FN = /^\s*at\s+(?:async\s+)?(\S.*?)\s*$/;
const GECKO = /^\s*([^@\s]*)@(.+?)\s*$/;

// Long lines are cut before matching so hostile stacks can't cause slow regex backtracking.
const MAX_LINE = 1024;

function parseFrame(rawLine) {
  const line = rawLine.length > MAX_LINE ? rawLine.slice(0, MAX_LINE) : rawLine;
  let m = V8_WITH_FN.exec(line);
  if (m) return { fn: m[1], file: m[2] };
  m = V8_NO_FN.exec(line);
  if (m) return { fn: '', file: m[1] };
  m = GECKO.exec(line);
  if (m) return { fn: m[1], file: m[2] };
  return null;
}

// Frames from dependencies and the runtime show where an error surfaced (e.g. inside Prisma),
// not which of our code caused it. Grouping on them would merge unrelated bugs into one issue.
function isLibraryFrame(file) {
  return file.includes('/node_modules/') || /^(?:node:|internal\/)/.test(file);
}

const MAX_FRAMES = 50;

// The first `count` in-app frames; all frames if the stack has no in-app ones.
function topFrames(stack, count = 3) {
  const frames = [];
  if (!stack) return frames;
  for (const line of stack.split('\n')) {
    const frame = parseFrame(line);
    if (frame) frames.push({ fn: frame.fn, file: normalizeFile(frame.file) });
    if (frames.length === MAX_FRAMES) break;
  }
  const inApp = frames.filter((f) => !isLibraryFrame(f.file));
  return (inApp.length ? inApp : frames).slice(0, count);
}

function firstChars(s, n) {
  return Array.from(s).slice(0, n).join(''); // don't split surrogate pairs
}

/** Returns { fingerprint, title, culprit } for a validated message. */
function describe(projectId, event) {
  const frames = topFrames(event.stack);
  const frameKeys = [0, 1, 2].map((i) => (frames[i] ? `${frames[i].fn}@${frames[i].file}` : ''));
  const input = [
    String(projectId),
    event.source,
    event.error_type,
    normalizeMessage(event.message),
    ...frameKeys,
  ].join('|');
  const fingerprint = crypto.createHash('sha256').update(input, 'utf8').digest('hex');

  const title = firstChars(`${event.error_type}: ${event.message}`, 200);
  let culprit = '';
  if (frames[0]) culprit = `${frames[0].fn || '<anonymous>'} (${frames[0].file})`;
  else if (event.http && event.http.route) culprit = event.http.route;
  else if (event.url_path) culprit = event.url_path;

  return { fingerprint, title, culprit: firstChars(culprit, 512) };
}

module.exports = { describe, normalizeMessage, normalizeFile, topFrames, isLibraryFrame };
