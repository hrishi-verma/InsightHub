// Contract §1 "Scrubbing on arrival". Senders scrub too; this is the second line of defense.

const URL_WITH_QUERY = /\b((?:https?|wss?):\/\/[^\s?#"'<>`]*)[?#][^\s"'<>`]*/gi;
const CREDENTIAL = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.]*\d)/g;
const IPV6_FULL = /(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}(?![\w:])/g;
const IPV6_COMPRESSED = /(?<![\w:])(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?(?![\w:])/g;
const LONG_RUN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g;

// A long run is a token if it is all hex, or mixes letters and digits like random base64url.
// Plain identifiers ("PrismaClientKnownRequestError") have no digits and are kept.
function isTokenLike(run) {
  if (/^[0-9a-fA-F]+$/.test(run)) return true;
  return /[0-9]/.test(run) && /[A-Za-z]/.test(run);
}

function scrub(text) {
  if (typeof text !== 'string' || text === '') return text;
  return text
    .replace(URL_WITH_QUERY, '$1')
    .replace(CREDENTIAL, '[credential]')
    .replace(JWT, '[jwt]')
    .replace(EMAIL, '[email]')
    .replace(IPV4, '[ip]')
    .replace(IPV6_FULL, '[ip]')
    .replace(IPV6_COMPRESSED, (m) => (m === '::' ? m : '[ip]'))
    .replace(LONG_RUN, (m) => (isTokenLike(m) ? '[token]' : m));
}

module.exports = { scrub };
