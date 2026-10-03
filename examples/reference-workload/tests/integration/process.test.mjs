import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('a separate Node process can use the public greeting API', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import { greet } from "./src/index.mjs"; console.log(greet("Factory"));'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'Hello, Factory!');
});
