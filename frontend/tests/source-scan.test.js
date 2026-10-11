// Guards against banned patterns creeping back into the app source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['app', 'components', 'lib'];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(js|jsx|mjs)$/.test(name) ? [p] : [];
  });
}
const sources = DIRS.flatMap((d) => files(join(ROOT, d))).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

const BANNED = [
  [/dangerouslySetInnerHTML/, 'renders HTML from strings'],
  [/dev-token-123/, 'hardcoded legacy token'],
  [/localStorage/, 'tokens must not live in localStorage'],
  [/innerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'raw DOM HTML sinks'],
  [/\beval\(|new Function\(/, 'dynamic code'],
  [/Demo credentials|admin123/, 'demo credentials'],
  [/['"]Authorization['"]\s*:/, 'the dashboard uses the session cookie, not bearer tokens'],
];

for (const [re, why] of BANNED) {
  test(`no ${re} in app source (${why})`, () => {
    const hits = sources.filter((f) => re.test(f.text)).map((f) => f.path);
    assert.deepEqual(hits, []);
  });
}

test('mock code is only reachable behind NEXT_PUBLIC_USE_MOCKS', () => {
  const importers = sources.filter((f) => /mock\.js'/.test(f.text)).map((f) => f.path);
  assert.deepEqual(importers, ['lib/api.js']);
  assert.match(readFileSync(join(ROOT, 'lib/api.js'), 'utf8'), /if \(process\.env\.NEXT_PUBLIC_USE_MOCKS === 'true'\) \{[\s\S]*import\('\.\/mock\.js'\)/);
});
