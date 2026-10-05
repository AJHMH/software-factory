import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('a separate process consumes the workload public export', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import {consumerMessage} from './src/index.mjs'; console.log(consumerMessage('external-process'));"], { encoding: 'utf8', cwd: new URL('../', import.meta.url) });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'Factory consumer: external-process');
});
