/**
 * Tests for the Browse by Provider / Topic card filter (lw-browse-filter.js).
 *
 * Run from the theme repo root, no dependencies:
 *   node tests/js/lw-browse-filter.test.js
 *
 * Only the pure matching logic behind `window.__LW_TEST__` is covered; check the DOM wiring
 * (hiding cards, the "No matches" status) in the browser.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = path.join(
  __dirname, '..', '..', 'tutorindigo', 'templates', 'indigo', 'lms', 'static', 'js', 'lw-browse-filter.js'
);

function load() {
  const window = { __LW_TEST__: {} };
  const document = { readyState: 'loading', addEventListener() {} };
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), vm.createContext({ window, document }));
  return window.__LW_TEST__.browseFilter;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const NAMES = ['Information Technology', 'Human Resources', 'Équipe Données', 'Data & Analytics'];
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('an empty or blank query matches every card', () => {
  const api = load();
  assert.deepStrictEqual(plain(api.matchingIndexes(NAMES, '')), [0, 1, 2, 3]);
  assert.deepStrictEqual(plain(api.matchingIndexes(NAMES, '   ')), [0, 1, 2, 3]);
});

test('matching is a case-insensitive substring', () => {
  const api = load();
  assert.deepStrictEqual(plain(api.matchingIndexes(NAMES, 'RES')), [1]);
  assert.deepStrictEqual(plain(api.matchingIndexes(NAMES, 'tech')), [0]);
});

test('accents are ignored on both sides', () => {
  const api = load();
  assert.deepStrictEqual(plain(api.matchingIndexes(NAMES, 'donnees')), [2]);
  assert.deepStrictEqual(plain(api.matchingIndexes(NAMES, 'ÉQUIPE')), [2]);
});

test('no match returns an empty list', () => {
  const api = load();
  assert.deepStrictEqual(plain(api.matchingIndexes(NAMES, 'zzz')), []);
});

test('special characters are matched literally', () => {
  const api = load();
  assert.deepStrictEqual(plain(api.matchingIndexes(NAMES, '&')), [3]);
  assert.deepStrictEqual(plain(api.matchingIndexes(NAMES, '.*')), []);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}\n  ${error.message}`);
  }
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log(`${tests.length} passed`);
