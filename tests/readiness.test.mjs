import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = fileURLToPath(new URL('../scripts/factory-validation.mjs', import.meta.url));
test('readiness inspection cannot turn implementation metadata into executed or hosted evidence', () => {
  const result = spawnSync(process.execPath, [cli, 'readiness', '--mode', 'inspect'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readiness, 'incomplete');
  assert.equal(report.outcome, 'not-run');
  assert.ok(report.results.every(result => result.status === 'not-run'));
  assert.ok(report.gaps.some(gap => gap.issue === 49));
  assert.ok(report.gaps.some(gap => gap.capability === 'certified-publication'));
  assert.ok(report.results.some(result => result.capability === 'redaction-and-retention'));
  assert.ok(report.results.some(result => result.capability === 'delivery-evidence-redaction'));
});

test('a controlled demonstration executes scenarios but cannot authorize hosted release or recovery', () => {
  const result = spawnSync(process.execPath, [cli, 'readiness', '--mode', 'demonstrate'], { encoding: 'utf8', timeout: 600000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'passed');
  assert.equal(report.readiness, 'incomplete');
  assert.ok(report.results.every(result => result.status === 'passed' && result.evidenceKind === 'controlled-test'));
  assert.ok(report.results.every(result => result.testsPassed > 0 && /^[a-f0-9]{64}$/.test(result.outputDigest)));
  assert.ok(report.results.some(result => result.testsSkipped > 0));
  assert.equal(report.results.some(result => result.evidenceKind === 'live-github'), false);
  assert.equal(report.results.some(result => Object.hasOwn(result, 'stdout')), false);
});

test('missing scenario evidence blocks the demonstration without exposing diagnostics or operator secrets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-readiness-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    copyFileSync(cli, join(directory, 'scripts/factory-validation.mjs'));
    copyFileSync(fileURLToPath(new URL('../scripts/readiness.mjs', import.meta.url)), join(directory, 'scripts/readiness.mjs'));
    const result = spawnSync(process.execPath, [join(directory, 'scripts/factory-validation.mjs'), 'readiness', '--mode', 'demonstrate'], {
      encoding: 'utf8', env: { ...process.env, GH_TOKEN: 'private-readiness-sentinel' }, timeout: 30000,
    });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, 'blocked');
    assert.equal(report.readiness, 'incomplete');
    assert.ok(report.results.every(result => result.status === 'failed'));
    assert.equal(result.stdout.includes('private-readiness-sentinel'), false);
    assert.equal(result.stdout.includes(directory), false);
    assert.equal(result.stderr, '');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('delivery evidence failures redact private filesystem inputs from public reports', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const result = spawnSync(process.execPath, [cli, 'release-artifact', '--mode', 'verify',
    '--trusted-repo', root, '--trusted-revision', revision,
    '--artifact-directory', join(root, 'tmp/private-delivery-sentinel')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).outcome, 'blocked');
  assert.equal(result.stdout.includes('private-delivery-sentinel'), false);
  assert.equal(result.stdout.includes(root), false);
  assert.equal(result.stderr, '');
});
