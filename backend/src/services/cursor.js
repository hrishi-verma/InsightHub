const { z } = require('zod');
const { ApiError } = require('../lib/errors');

// Opaque keyset cursors: base64url JSON. Contents are validated on the way back in.

const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

function decode(cursor, schema) {
  if (cursor === undefined) return null;
  try {
    if (cursor.length > 300 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('bad cursor');
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'cursor: invalid');
  }
}

// Postgres timestamptz rendered as ::text (UTC session), e.g. "2026-10-11 09:30:00.123456+00".
const pgTimestampText = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00$/);
const bigintText = z.string().regex(/^\d{1,19}$/);
const uuidText = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

module.exports = { encode, decode, pgTimestampText, bigintText, uuidText };
