import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts/factory-validation.mjs');

function fixture(t) {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const directory = mkdtempSync(join(root, 'tmp/contract-'));
  t.after(() => {
    const target = realpathSync(directory);
    const within = relative(realpathSync(join(root, 'tmp')), target);
    assert.ok(within && within !== '..' && !within.startsWith('..' + sep) && !isAbsolute(within));
    rmSync(target, { recursive: true, force: true });
  });
  writeFileSync(join(directory, 'step.mjs'), "console.log(process.argv[2], process.cwd());\n");
  const command = (label) => ({ run: `"${process.execPath}" step.mjs ${label}`, timeout_seconds: 5 });
  const contract = {
    version: '1.0',
    contract: {
      workload_id: 'test-workload', profile: 'node-24', working_directory: '.',
      commands: { install: command('install'), validate: command('validate'), test: command('test'), build: command('build') },
    },
  };
  const path = join(directory, 'factory-contract.yaml');
  writeFileSync(path, JSON.stringify(contract));
  return { directory, path, contract };
}

function run(path, ...args) {
  return spawnSync(process.execPath, [cli, 'validate', '--contract', path, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
  });
}

test('a valid contract runs all four gates in its working directory with revision-bound evidence', (t) => {
  const { directory, path } = fixture(t);
  const result = run(path);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'passed');
  assert.equal(report.workloadId, 'test-workload');
  assert.match(report.revision, /^[a-f0-9]{40}$/);
  assert.equal(report.revision, spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim());
  assert.equal(typeof report.workingTreeDirty, 'boolean');
  assert.match(report.contractDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.results.map((gate) => gate.capability), ['install', 'validate', 'test', 'build']);
  assert.ok(report.results.every((gate) => gate.status === 'passed' && gate.exitCode === 0 && gate.startedAt && gate.finishedAt));
  assert.ok(report.results.every((gate) => gate.stdout.includes(directory)));
});

test('malformed contracts and unsupported profiles are rejected before any workload command runs', (t) => {
  const { directory, path, contract } = fixture(t);
  const marker = join(directory, 'executed');
  writeFileSync(join(directory, 'step.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('executed', 'yes');\n");
  for (const mutate of [
    (value) => { value.version = '2.0'; },
    (value) => { value.contract.profile = 'python'; },
    (value) => { value.contract.commands.validate.run = ' '; },
    (value) => { delete value.contract.commands.build; },
    (value) => { value.contract.commands.test.timeout_seconds = 0; },
    (value) => { value.contract.commands.validate.extra = true; },
    (value) => { value.contract.working_directory = '..'; },
    (value) => { value.contract.working_directory = root; },
  ]) {
    const value = structuredClone(contract);
    mutate(value);
    writeFileSync(path, JSON.stringify(value));
    const result = run(path);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0].capability, 'contract-validation');
    assert.equal(report.results[0].status, 'failed');
    assert.ok(report.results[0].reason);
    assert.throws(() => readFileSync(marker), /ENOENT/);
  }
  writeFileSync(path, 'version: [\n');
  assert.equal(run(path).status, 1);
});

test('compound validation commands execute both operations and propagate failure before later gates', (t) => {
  const { path, contract } = fixture(t);
  const command = contract.contract.commands.validate;
  command.run += ` && "${process.execPath}" -e "process.exit(23)"`;
  writeFileSync(path, JSON.stringify(contract));
  const result = run(path);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.results.map((gate) => gate.capability), ['install', 'validate']);
  assert.equal(report.results[1].exitCode, 23);
  assert.equal(report.results[1].timedOut, false);
  assert.match(report.results[1].stdout, /validate/);
});

test('a timed-out command is stopped and cannot satisfy a gate or start later commands', (t) => {
  const { path, contract } = fixture(t);
  contract.contract.commands.install = {
    run: `"${process.execPath}" -e "setInterval(() => {}, 100)"`, timeout_seconds: 1,
  };
  writeFileSync(path, JSON.stringify(contract));
  const result = run(path);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].timedOut, true);
  assert.equal(report.results[0].terminationFailed, false);
  assert.equal(report.results[0].status, 'failed');
});

test('profile inspection validates the contract and publishes only the supported runtime selection', (t) => {
  const { directory, path } = fixture(t);
  const output = join(directory, 'github-output');
  const result = spawnSync(process.execPath, [cli, 'profile', '--contract', path], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '' },
  });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.profile.id, 'node-24');
  assert.equal(report.profile.nodeVersion, '24');
  assert.equal(report.results.length, 0, 'Inspection must not execute commands');
  assert.equal(readFileSync(output, 'utf8'), 'node_version=24\n');
});

test('a failed install preserves its exit code and does not execute validation, tests, or build', (t) => {
  const { path, contract } = fixture(t);
  contract.contract.commands.install.run = `"${process.execPath}" -e "process.exit(17)"`;
  writeFileSync(path, JSON.stringify(contract));
  const result = run(path);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.results.map((gate) => gate.capability), ['install']);
  assert.equal(report.results[0].exitCode, 17);
});
