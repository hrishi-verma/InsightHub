// Contract §1 "Scrubbing on arrival". Senders scrub too; this is the second line of defense.

// Patterns must stay linear on hostile input (D24): each one consumes a whole run once and trims
// in a callback, instead of scanning ahead for a later character (quadratic) or capping the length
// (which lets anything past the cap through unscrubbed).

// The whole URL, then cut at the first ? or #.
const URL = /\b(?:https?|wss?):\/\/[^\s"'<>`]*/gi;
const CREDENTIAL = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
// Starts only at the beginning of a run (lookbehind), so a long run without '@' is scanned once.
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.]*\d)/g;
const IPV6_FULL = /(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}(?![\w:])/g;
const IPV6_COMPRESSED = /(?<![\w:])(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?(?![\w:])/g;
// Home directories in stack paths name the OS user ("/Users/jane/...", "C:\\Users\\Jane Doe\\...").
const HOME_POSIX = /(^|[\s(@'"`]|file:\/\/)\/(?:Users|home)\/[^\/\s"'<>`]+(?=\/)/g;
const HOME_WINDOWS = /\b[A-Za-z]:[\\/]Users[\\/][^\\/\r\n"'<>`:*?|]+(?=[\\/])/gi;
const LONG_RUN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g;

// A long run is a token if it is all hex, or mixes letters and digits like random base64url.
// Plain identifiers ("PrismaClientKnownRequestError") have no digits and are kept.
function isTokenLike(run) {
  if (/^[0-9a-fA-F]+$/.test(run)) return true;
  return /[0-9]/.test(run) && /[A-Za-z]/.test(run);
}

const cutQuery = (url) => url.replace(/[?#].*$/s, '');

// "jane%40example.com" or "?token%3Dabc" would slip past the rules below, so the characters they
// depend on are decoded first. Only these; other escapes are left alone (no decodeURIComponent,
// which throws on malformed input and would change unrelated text).
const SCRUB_RELEVANT_ESCAPES = { 20: ' ', 23: '#', 26: '&', '2b': '+', '2f': '/', '3a': ':', '3d': '=', '3f': '?', 40: '@' };
const PERCENT = /%(20|23|26|2[bf]|3[adf]|40)/gi;
const decodeRelevant = (text) => text.replace(PERCENT, (m, hex) => SCRUB_RELEVANT_ESCAPES[hex.toLowerCase()]);

// `homeDirs: false` for url_path: "/home/courses" there is a site route, not a filesystem path.
function scrub(text, { homeDirs = true } = {}) {
  if (typeof text !== 'string' || text === '') return text;
  const decoded = decodeRelevant(text);
  const withoutHomes = homeDirs ? decoded.replace(HOME_POSIX, '$1~').replace(HOME_WINDOWS, '~') : decoded;
  return withoutHomes
    .replace(URL, cutQuery)
    .replace(CREDENTIAL, '[credential]')
    .replace(JWT, '[jwt]')
    .replace(EMAIL, '[email]')
    .replace(IPV4, '[ip]')
    .replace(IPV6_FULL, '[ip]')
    .replace(IPV6_COMPRESSED, (m) => (m === '::' ? m : '[ip]'))
    .replace(LONG_RUN, (m) => (isTokenLike(m) ? '[token]' : m));
}

module.exports = { scrub };
