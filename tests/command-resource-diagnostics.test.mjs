import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execute } from '../scripts/contract-execution.mjs';

const run = `"${process.execPath}" -e "process.exit(0)"`;

test('actual command evidence retains bounded numeric resource samples without secrets', async () => {
  const result = await execute({ run, timeout_seconds: 2 }, process.cwd());
  assert.equal(result.status, 'passed');
  assert.equal(result.resourceDiagnostics.schemaVersion, 1);
  assert.ok(result.resourceDiagnostics.samples.length >= 2);
  assert.ok(result.resourceDiagnostics.samples.length <= 128);
  for (const sample of result.resourceDiagnostics.samples) {
    assert.equal(typeof sample.elapsedMs, 'number');
    assert.equal(typeof sample.supervisor.userCPUTime, 'number');
  }
  const text = JSON.stringify(result.resourceDiagnostics);
  assert.ok(!text.includes(process.cwd()));
  assert.ok(!text.includes(run));
});

test('sampling failure cannot interrupt the existing deadline or command termination', () => {
  const script = `
    import { execute } from './scripts/contract-execution.mjs';
    process.resourceUsage = () => { throw Error('private sentinel'); };
    const result = await execute({run: ${JSON.stringify(`"${process.execPath}" -e "setInterval(()=>{},100)"`)}, timeout_seconds: 1}, process.cwd());
    console.log(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 4000 });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.timedOut, true);
  assert.equal(result.terminationFailed, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.resourceDiagnostics.samplingFailed, true);
  assert.ok(!JSON.stringify(result.resourceDiagnostics).includes('private sentinel'));
});

test('diagnostic timers do not keep a completed command supervisor alive', () => {
  const script = `import {execute} from './scripts/contract-execution.mjs'; await execute({run:${JSON.stringify(run)},timeout_seconds:60},process.cwd());`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
});


test('an evidence write refusal occurs only after the timed-out child is stopped', (t) => {
  mkdirSync('tmp', { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), 'tmp/resource-write-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const childPath = join(directory, 'child.mjs');
  const pidPath = join(directory, 'child.pid');
  writeFileSync(childPath, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},100);`);
  const command = { run: `"${process.execPath}" "${childPath}"`, timeout_seconds: 1 };
  const contract = join(directory, 'factory-contract.yaml');
  writeFileSync(contract, JSON.stringify({version:'1.0',contract:{workload_id:'diagnostic-write-refusal',profile:'node-24',working_directory:'.',commands:{install:command,validate:command,test:command,build:command}}}));
  const evidence = join(directory, 'evidence');
  mkdirSync(evidence);
  const result = spawnSync(process.execPath, ['scripts/factory-validation.mjs','validate','--contract',contract,'--evidence-output',evidence], {encoding:'utf8',timeout:5000});
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Validation evidence output must be a regular file/);
  const pid = Number(readFileSync(pidPath, 'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('resource sampling stops at its fixed in-memory limit', async (t) => {
  const { startResourceDiagnostics } = await import('../scripts/command-resource-diagnostics.mjs');
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stop = startResourceDiagnostics();
  t.mock.timers.tick(260000);
  const result = stop();
  assert.equal(result.samples.length, 128);
  assert.equal(result.sampleLimitReached, true);
  assert.equal(result.samplingFailed, false);
});
