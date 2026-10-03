import assert from 'node:assert/strict';
import test from 'node:test';
import { greet } from '../src/index.mjs';

test('a named user receives a greeting', () => {
  assert.equal(greet('Factory'), 'Hello, Factory!');
  assert.equal(greet('  Ada  '), 'Hello, Ada!');
});

test('empty and invalid names are rejected', () => {
  for (const name of ['', ' ', null, 42]) assert.throws(() => greet(name), TypeError);
});
