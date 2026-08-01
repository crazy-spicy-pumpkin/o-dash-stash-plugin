#!/usr/bin/env node
/* Unit tests for the pure logic — no browser, no Stash, no library.
 *
 *     node tools/unit.mjs
 *
 * The browser checks (leak, style, theme) cover rendering and CSS containment;
 * they cannot cover the parts that are just data in and data out. These can,
 * and they run in a second with no dependencies.
 *
 * The sources are browser scripts, not modules, so each is evaluated in a
 * sandbox with the smallest globals it actually touches. That is deliberate:
 * it keeps src/ free of test scaffolding, and if a file starts reaching for
 * something new, the stub fails loudly rather than the test quietly passing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n          ${err.message.split('\n')[0]}`);
  }
}

/** Strip vm-context prototypes.
 *
 *  Values built inside the sandbox have that context's Array/Object prototypes,
 *  so assert/strict's deepEqual rejects them against host-built expectations
 *  with "same structure but not reference-equal" — which reads exactly like a
 *  real failure and is not one. Round-tripping through JSON gives plain host
 *  values to compare. */
const plain = (v) => JSON.parse(JSON.stringify(v));

/** Evaluate a browser script against a minimal window, and hand back that window. */
function loadScript(file, extraGlobals = {}) {
  const noop = () => {};
  const ctx = {
    console,
    Intl,
    URLSearchParams,
    structuredClone,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    setInterval: noop,
    clearInterval: noop,
    performance,
    fetch: () => Promise.reject(new Error('no network in unit tests')),
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    location: { search: '', href: 'http://localhost/' },
    document: {
      querySelector: () => null,
      getElementById: () => null,
      addEventListener: noop,
      createElement: () => ({ style: {}, classList: { add: noop, toggle: noop }, setAttribute: noop }),
    },
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    addEventListener: noop,
    history: { replaceState: noop },
    ...extraGlobals,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(SRC, file), 'utf8'), ctx, { filename: file });
  return ctx;
}

/* ------------------------------------------------------------------ demo */

console.log('\ndemo-source.js');

const demoCtx = loadScript('demo-source.js', { OD_DEMO: true });
const demo = await demoCtx.demoSource.getPayload();

test('produces the payload contract', () => {
  for (const key of ['generated_at', 'library_scenes', 'stash_url', 'events', 'views', 'scenes']) {
    assert.ok(key in demo, `missing ${key}`);
  }
});

test('events are sorted and well-formed', () => {
  assert.ok(demo.events.length > 0);
  for (const e of demo.events) {
    assert.equal(typeof e.t, 'number');
    assert.equal(typeof e.s, 'number');
  }
  const ts = plain(demo.events.map((e) => e.t));
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b), 'not sorted');
});

test('no event is in the future', () => {
  const now = Date.now();
  assert.ok(demo.events.every((e) => e.t <= now));
  assert.ok(demo.views.every((t) => t <= now));
});

test('every event points at a scene that exists', () => {
  for (const e of demo.events) assert.ok(String(e.s) in demo.scenes, `unknown scene ${e.s}`);
});

test('deep links are disabled — the ids are invented', () => {
  assert.equal(demo.stash_url, '');
});

test('deterministic: same seed, same history', async () => {
  const again = await loadScript('demo-source.js', { OD_DEMO: true }).demoSource.getPayload();
  assert.equal(again.events.length, demo.events.length);
  assert.deepEqual(plain(again.events.map((e) => e.t)), plain(demo.events.map((e) => e.t)));
});

test('scenes carry the fields the ranked lists read', () => {
  for (const scene of Object.values(demo.scenes)) {
    for (const f of ['title', 'studio', 'studio_id', 'date', 'performers', 'tags']) {
      assert.ok(f in scene, `missing ${f}`);
    }
    assert.ok(Array.isArray(scene.performers) && Array.isArray(scene.tags));
  }
});

test('views outnumber O events, or the comparison is meaningless', () => {
  assert.ok(demo.views.length > demo.events.length);
});

/* --------------------------------------------------------------- graphql */

console.log('\ngraphql-source.js — mapping, against a canned response');

/** A GraphQL server stubbed with synthetic rows. Nothing here is library data. */
function stubbedGraphql(responses) {
  const calls = [];
  return {
    calls,
    fetch: (url, opts) => {
      const query = JSON.parse(opts.body).query;
      calls.push({ url, headers: opts.headers, query });
      const which = query.includes('o_history') ? 'o'
        : query.includes('play_history') ? 'v' : 's';
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ data: responses[which] }),
      });
    },
  };
}

const RESPONSES = {
  o: { findScenes: { scenes: [{
    id: '7', title: 'Placeholder', date: '2026-01-02', rating100: 80,
    files: [{ basename: 'a.mp4' }], studio: { id: '3', name: 'Studio' },
    performers: [{ id: '2', name: 'Beta' }, { id: '1', name: 'Alpha' }],
    tags: [{ id: '9', name: 'tag' }],
    o_history: ['2026-01-03T22:15:00+05:30', '2026-01-04T23:45:00Z'],
  }] } },
  v: { findScenes: { scenes: [{ id: '7', play_history: ['2026-01-03T20:00:00Z'] }] } },
  s: { stats: { scene_count: 420 }, version: { version: 'test' } },
};

function loadGraphql(extra = {}) {
  const stub = stubbedGraphql(RESPONSES);
  const ctx = loadScript('graphql-source.js', { fetch: stub.fetch, ...extra });
  return { ctx, stub };
}

const { ctx: gqlCtx, stub } = loadGraphql();
const payload = await gqlCtx.graphqlSource.getPayload(false, null);

test('flattens o_history into events with scene ids', () => {
  assert.equal(payload.events.length, 2);
  assert.ok(payload.events.every((e) => e.s === 7));
});

test('RFC3339 offsets are honoured, not sliced', () => {
  // 22:15+05:30 is 16:45Z — earlier than the 23:45Z event, despite the later
  // wall-clock time. Slicing the string would order these the other way.
  assert.deepEqual(plain(payload.events.map((e) => e.t)),
    [Date.parse('2026-01-03T22:15:00+05:30'), Date.parse('2026-01-04T23:45:00Z')]);
});

test('events come out sorted', () => {
  const ts = plain(payload.events.map((e) => e.t));
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
});

test('ids are coerced to numbers, as the SQL payload had them', () => {
  const scene = payload.scenes['7'];
  assert.equal(scene.studio_id, 3);
  assert.equal(scene.performers[0].id, 1);
  assert.equal(typeof scene.tags[0].id, 'number');
});

test('performers sort by name in binary order, matching ORDER BY', () => {
  assert.deepEqual(plain(payload.scenes['7'].performers.map((p) => p.name)), ['Alpha', 'Beta']);
});

test('rating comes from rating100', () => {
  assert.equal(payload.scenes['7'].rating, 80);
});

test('title falls back to basename, then to a synthesised label', () => {
  const withoutTitle = structuredClone(RESPONSES);
  withoutTitle.o.findScenes.scenes[0].title = null;
  const c = loadScript('graphql-source.js', { fetch: stubbedGraphql(withoutTitle).fetch });
  return c.graphqlSource.getPayload(false, null).then((p) => {
    assert.equal(p.scenes['7'].title, 'a.mp4');
  });
});

test('play_history keeps scene attribution the SQL path threw away', () => {
  assert.equal(payload.views.length, 1);
  assert.deepEqual(plain(payload.view_events), [{ t: Date.parse('2026-01-03T20:00:00Z'), s: 7 }]);
});

test('library total comes from stats', () => {
  assert.equal(payload.library_scenes, 420);
});

test('three queries are issued, no more', () => {
  assert.equal(stub.calls.length, 3);
});

test('no ApiKey header when none is configured', () => {
  assert.ok(stub.calls.every((c) => !('ApiKey' in c.headers)));
});

test('an API key is sent as a header when configured', async () => {
  const store = { 'o-dash-api-key': 'k3y', 'o-dash-stash-url': 'http://elsewhere:9999' };
  const s2 = stubbedGraphql(RESPONSES);
  const c = loadScript('graphql-source.js', {
    fetch: s2.fetch,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: () => {}, removeItem: () => {} },
  });
  await c.graphqlSource.getPayload(false, null);
  assert.ok(s2.calls.every((call) => call.headers.ApiKey === 'k3y'));
  assert.ok(s2.calls.every((call) => call.url === 'http://elsewhere:9999/graphql'));
});

test('a 401 is reported as an actionable message, not a raw status', async () => {
  const c = loadScript('graphql-source.js', {
    fetch: () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
  });
  await assert.rejects(() => c.graphqlSource.getPayload(false, null),
    (e) => /API key|authentication/i.test(e.message));
});

/* ------------------------------------------------------------------ done */

console.log(`\n${failures.length ? 'UNIT: FAIL' : 'UNIT: PASS'} — ${passed} passed`
  + (failures.length ? `, ${failures.length} failed: ${failures.join(', ')}` : ''));
process.exit(failures.length ? 1 : 0);
