import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { monitorHealth, readOperationsPolicy } from '../scripts/health-monitoring.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function fixture(directory, result, extra = []) {
  const stateFile = join(directory, 'health-state.json');
  const evidenceFile = join(directory, 'health-evidence.json');
  const invoked = spawnSync(process.execPath, [
    join(root, 'scripts/factory-validation.mjs'), 'health-monitoring',
    '--repository', 'owner/repo', '--workload-id', 'test-service',
    '--fixture-result', result, '--state-file', stateFile,
    '--evidence-output', evidenceFile, ...extra,
  ], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  const report = JSON.parse(invoked.stdout.trim().split(/\r?\n/).at(-1));
  return { ...invoked, report, stateFile, evidenceFile };
}

test('public health interface deduplicates threshold incidents and records recovery without paging', t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-health-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const healthy = fixture(directory, 'healthy');
  assert.equal(healthy.status, 0);
  assert.equal(healthy.report.evidence.incidentAction, 'none');
  assert.equal(healthy.report.evidence.metrics.availability.status, 'provisional');

  for (let count = 1; count <= 2; count++) {
    const failing = fixture(directory, 'failed');
    assert.equal(failing.status, 1);
    assert.equal(failing.report.evidence.consecutiveFailures, count);
    assert.equal(failing.report.evidence.incidentAction, 'none');
  }

  const threshold = fixture(directory, 'failed');
  assert.equal(threshold.report.outcome, 'failed');
  assert.equal(threshold.report.evidence.incidentAction, 'opened');
  assert.match(threshold.report.evidence.incidentUrl, /issues\/fixture$/);

  const repeated = fixture(directory, 'failed');
  assert.equal(repeated.report.evidence.consecutiveFailures, 4);
  assert.equal(repeated.report.evidence.incidentAction, 'none');
  let state = JSON.parse(readFileSync(threshold.stateFile, 'utf8'));
  assert.equal(state.fixtureNotifications.filter(item => item.type === 'incident_opened').length, 1);

  const recovered = fixture(directory, 'healthy');
  assert.equal(recovered.status, 0);
  assert.equal(recovered.report.evidence.incidentAction, 'recovered');
  state = JSON.parse(readFileSync(recovered.stateFile, 'utf8'));
  assert.equal(state.fixtureIncident.status, 'closed');
  assert.equal(state.fixtureNotifications.filter(item => item.type === 'incident_recovered').length, 1);
  assert.equal(recovered.report.evidence.metrics.mttr.completedIncidents, 1);
  assert.deepEqual(recovered.report.evidence.metrics.unsupported.map(item => item.name), ['lead_time', 'deployment_frequency', 'change_failure_rate']);
});

test('timeout probes count as consecutive failures and fixtures cannot page externally', t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-health-timeout-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  fixture(directory, 'timeout');
  fixture(directory, 'timeout');
  const threshold = fixture(directory, 'timeout');
  assert.equal(threshold.report.evidence.probe.status, 'timeout');
  assert.equal(threshold.report.evidence.incidentAction, 'opened');
  assert.equal(threshold.report.simulated, true);
  assert.equal(JSON.parse(readFileSync(threshold.stateFile, 'utf8')).fixtureNotifications.length, 1);
});

test('real probe adapter classifies unexpected statuses and timeouts', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-health-probe-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const policy = readOperationsPolicy();
  policy.operations.health_checks.consecutive_failures_for_alert = 5;
  let tick = 10_000;
  const options = { repository: 'owner/repo', workloadId: 'test-service', endpoint: 'https://service.example/health', stateFile: join(directory, 'health-state.json') };

  const unexpected = await monitorHealth(options, {
    policy, clock: () => tick++,
    fetch: async () => new Response(null, { status: 503 }),
  });
  assert.equal(unexpected.evidence.probe.httpStatus, 503);
  assert.equal(unexpected.evidence.probe.status, 'failed');

  const timedOut = await monitorHealth(options, {
    policy, clock: () => tick++,
    fetch: async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; },
  });
  assert.equal(timedOut.evidence.probe.httpStatus, null);
  assert.equal(timedOut.evidence.probe.status, 'timeout');
  assert.equal(timedOut.evidence.consecutiveFailures, 2);
});

test('GitHub adapter opens one incident, records recovery, and closes it idempotently', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-health-github-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const policy = readOperationsPolicy();
  policy.operations.health_checks.consecutive_failures_for_alert = 1;
  let now = Date.parse('2026-10-01T00:00:00.000Z');
  const calls = [];
  let healthy = false;
  const issue = { number: 73, html_url: 'https://github.com/owner/repo/issues/73', created_at: new Date(now).toISOString(), body: '', state: 'open' };
  const comments = [];
  /** @type {typeof fetch} */
  const fetchMock = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    calls.push({ url: url.href, method, authorization: new Headers(init.headers).get('authorization') });
    if (url.hostname === 'service.example') return new Response(null, { status: healthy ? 200 : 503 });
    if (url.pathname === '/repos/owner/repo/issues' && method === 'GET') return new Response('[]', { status: 200 });
    if (url.pathname === '/repos/owner/repo/issues' && method === 'POST') {
      Object.assign(issue, JSON.parse(String(init.body)));
      return new Response(JSON.stringify(issue), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/repos/owner/repo/issues/73' && method === 'GET') return new Response(JSON.stringify(issue), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/repos/owner/repo/issues/73/comments' && method === 'GET') return new Response(JSON.stringify(comments), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/repos/owner/repo/issues/73/comments' && method === 'POST') {
      comments.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(comments.at(-1)), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/repos/owner/repo/issues/73' && method === 'PATCH') {
      Object.assign(issue, JSON.parse(String(init.body)));
      return new Response(JSON.stringify(issue), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  const options = { repository: 'owner/repo', workloadId: 'test-service', endpoint: 'https://service.example/health', stateFile: join(directory, 'health-state.json') };
  const dependencies = { policy, fetch: fetchMock, githubToken: 'fixture-token-only', clock: () => now };

  const opened = await monitorHealth(options, dependencies);
  assert.equal(opened.evidence.incidentAction, 'opened');
  assert.equal(opened.evidence.incidentUrl, issue.html_url);
  assert.match(issue.body, /factory-health-incident:v1/);
  assert.equal(calls.filter(call => new URL(call.url).hostname === 'api.github.com').every(call => call.authorization === 'Bearer fixture-token-only'), true);

  now += 60_000;
  const repeated = await monitorHealth(options, dependencies);
  assert.equal(repeated.evidence.incidentAction, 'none');
  assert.equal(calls.filter(call => call.method === 'POST' && call.url.endsWith('/issues')).length, 1);

  now += 60_000;
  healthy = true;
  const recovered = await monitorHealth(options, dependencies);
  assert.equal(recovered.evidence.incidentAction, 'recovered');
  assert.equal(issue.state, 'closed');
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /Recovery confirmed/);
  assert.equal(recovered.evidence.metrics.mttr.valueMinutes, 2);
});

test('GitHub permission denial blocks incident success while retaining failure state', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-health-denied-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const policy = readOperationsPolicy();
  policy.operations.health_checks.consecutive_failures_for_alert = 1;
  const report = await monitorHealth({ repository: 'owner/repo', workloadId: 'test-service', endpoint: 'https://service.example/health', stateFile: join(directory, 'health-state.json') }, {
    policy, githubToken: 'fixture-token-only',
    fetch: async input => new URL(String(input)).hostname === 'service.example' ? new Response(null, { status: 503 }) : new Response('{}', { status: 403 }),
  });
  assert.equal(report.outcome, 'blocked');
  assert.match(report.results[0].reason, /issues: write/);
  assert.equal(JSON.parse(readFileSync(join(directory, 'health-state.json'), 'utf8')).consecutiveFailures, 1);
});

test('missing or unsafe endpoint configuration fails closed through the public interface', t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-health-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'health-state.json');
  const evidenceFile = join(directory, 'health-evidence.json');
  const invoked = spawnSync(process.execPath, [
    join(root, 'scripts/factory-validation.mjs'), 'health-monitoring',
    '--repository', 'owner/repo', '--workload-id', 'test-service',
    '--state-file', stateFile, '--evidence-output', evidenceFile,
  ], { cwd: root, encoding: 'utf8', timeout: 10_000, env: { ...process.env, FACTORY_HEALTH_ENDPOINT: '' } });
  const report = JSON.parse(invoked.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(invoked.status, 1);
  assert.equal(report.outcome, 'blocked');
  assert.match(report.results[0].reason, /FACTORY_HEALTH_ENDPOINT is required/);
  assert.deepEqual(JSON.parse(readFileSync(evidenceFile, 'utf8')), report);

  const unsafe = spawnSync(process.execPath, [
    join(root, 'scripts/factory-validation.mjs'), 'health-monitoring',
    '--repository', 'owner/repo', '--workload-id', 'test-service', '--state-file', stateFile,
  ], { cwd: root, encoding: 'utf8', timeout: 10_000, env: { ...process.env, FACTORY_HEALTH_ENDPOINT: 'https://example.com/health?token=secret' } });
  const unsafeReport = JSON.parse(unsafe.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(unsafeReport.outcome, 'blocked');
  assert.match(unsafeReport.results[0].reason, /cannot contain credentials, query parameters, or a fragment/);
});
