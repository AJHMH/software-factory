import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../scripts/factory-validation.mjs', import.meta.url));

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('an implemented capability without executed evidence cannot satisfy a required gate', () => {
  const result = run('capability', 'contract-validation', '--required');
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.results[0].status, 'not-run');
  assert.equal(report.results[0].required, true);
  assert.match(report.results[0].reason, /no executed gate evidence/i);
  assert.equal(report.results[0].trackingIssue, 3);
});

test('release certification is blocked by every unsupported mandatory capability', () => {
  const result = run('certify');
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'blocked');
  assert.ok(report.results.some((gate) => gate.capability === 'contract-validation' && gate.status === 'not-run'));
  assert.ok(report.results.some((gate) => gate.capability === 'policy-review' && gate.status === 'not-run'));
  assert.ok(report.results.some((gate) => gate.capability === 'coverage' && gate.status === 'not-run'));
  for (const capability of ['secret-scanning', 'dependency-scanning']) assert.ok(report.results.some(gate=>gate.capability === capability && gate.required && gate.status === 'not-run'));
  for (const capability of ['sast-policy', 'release-certification']) {
    assert.ok(report.results.some((gate) => gate.capability === capability && gate.required && gate.status === 'unsupported'));
  }
  assert.ok(report.results.every((gate) => gate.status !== 'passed'));
});

test('disabled optional automation reports unsupported without authorizing any action', () => {
  const result = run('capability', 'agent-remediation');
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'unsupported');
  assert.equal(report.results[0].status, 'unsupported');
  assert.equal(report.results[0].required, false);
  assert.match(report.results[0].reason, /disabled/i);
});

test('operators can inventory every capability without implying any gate passed', () => {
  const result = run('inventory');
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'unsupported');
  assert.equal(report.results.length, 11);
  assert.ok(report.results.some((gate) => gate.capability === 'contract-validation' && gate.status === 'available'));
  assert.ok(report.results.every((gate) => ['available', 'unsupported'].includes(gate.status) && gate.reason && gate.trackingIssue));
});

test('invalid invocations cannot silently turn a mandatory request into a passing gate', () => {
  for (const args of [[], ['capability', 'unknown'], ['capability', 'constructor'],
    ['capability', 'contract-validation', '--requred'], ['certify', '--optional']]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage:/);
    assert.equal(result.stdout, '');
  }
});
