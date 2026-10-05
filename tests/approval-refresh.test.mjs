import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
function fixture(t) {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const directory = mkdtempSync(join(root, 'tmp/approval-refresh-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo'); mkdirSync(join(repo, 'policies'), { recursive: true });
  writeFileSync(join(repo, 'policies/human-review.yaml'), readFileSync(join(root, 'policies/human-review.yaml')));
  const git = (...args) => { const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init'); git('add', '.'); git('-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'trusted policy');
  const base = git('rev-parse', 'HEAD'), head = 'b'.repeat(40);
  const timestamp = seconds => new Date(Date.now() - seconds * 1000).toISOString();
  const run = (id, workflowId, filename, event) => ({ id, workflow_id: workflowId, path: `.github/workflows/${filename}`, event,
    head_sha: head, head_branch: 'feat/example', status: 'completed', repository: { full_name: 'org/repo' },
    display_title: `factory-review:7:${head}:${base}`, created_at: timestamp(30) });
  const state = {
    pr: { number: 7, state: 'open', user: { login: 'ajhmh-software-factory[bot]' }, head: { sha: head, ref: 'feat/example', repo: { full_name: 'org/repo' } }, base: { sha: base, ref: 'main', repo: { full_name: 'org/repo' } } },
    trigger: { ...run(900, 3, 'factory-review-event.yml', 'pull_request_review'), display_title: `factory-review-event:7:${head}:${base}:submitted`, actor: { login: 'aaron-howard', type: 'User' }, triggering_actor: { login: 'aaron-howard', type: 'User' }, created_at: timestamp(10) },
    runs: [run(100, 1, 'factory-agent-review.yml', 'pull_request'), run(101, 2, 'factory-policy.yml', 'pull_request_target')],
    jobs: { 100: { id: 501, run_id: 100, name: 'Enforce Factory human approval', head_sha: head, status: 'completed', conclusion: 'failure', started_at: timestamp(20) },
      101: { id: 502, run_id: 101, name: 'Enforce Factory trusted human approval', head_sha: head, status: 'completed', conclusion: 'failure', started_at: timestamp(20) } },
    reviews: [{ id: 1, user: { login: 'aaron-howard', type: 'User' }, state: 'APPROVED', commit_id: head, submitted_at: timestamp(12), body: 'private-review-sentinel' }],
  };
  const runCli = (mode = 'apply') => {
    const filename = join(directory, 'api.json'); writeFileSync(filename, JSON.stringify(state));
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(join(root, 'tests/fixtures/approval-refresh-api.mjs')).href,
      join(root, 'scripts/factory-validation.mjs'), 'refresh-approvals', '--mode', mode, '--repository', 'org/repo',
      '--trigger-run', '900', '--trusted-repo', repo, '--trusted-revision', base], {
      encoding: 'utf8', env: { ...process.env, FACTORY_GITHUB_TOKEN: 'fixture-private-token', FACTORY_TEST_API: filename, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' },
    });
    return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null, api: JSON.parse(readFileSync(filename, 'utf8')) };
  };
  return { state, runCli, base, head };
}

test('a current authorized review refreshes existing approval jobs without granting approval or creating checks', t => {
  const f = fixture(t), result = f.runCli();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.outcome, 'requested');
  assert.deepEqual(result.api.writes, ['/repos/org/repo/actions/jobs/501/rerun', '/repos/org/repo/actions/jobs/502/rerun']);
  assert.equal(result.stdout.includes('private-review-sentinel'), false);
  assert.equal(result.stdout.includes('fixture-private-token'), false);
});

test('missing original trusted approval evidence prevents all refresh mutations', t => {
  const f = fixture(t); f.state.jobs[101].name = 'Unrelated job';
  const result = f.runCli();
  assert.equal(result.status, 1);
  assert.equal(result.report.outcome, 'blocked');
  assert.deepEqual(result.api.writes ?? [], []);
});

test('read-only inspection rejects a head changed while the review request is being authorized', t => {
  const f = fixture(t); f.state.stale = true;
  const result = f.runCli('inspect');
  assert.equal(result.status, 1);
  assert.equal(result.report.outcome, 'blocked');
  assert.deepEqual(result.api.writes ?? [], []);
});

test('replayed review events do not rerun jobs that already evaluated after the event', t => {
  const f = fixture(t);
  for (const job of Object.values(f.state.jobs)) job.started_at = new Date().toISOString();
  const result = f.runCli();
  assert.equal(result.status, 0);
  assert.equal(result.report.outcome, 'not-required');
  assert.deepEqual(result.api.writes ?? [], []);
  assert.ok(result.report.requests.every(request => request.status === 'already-current'));
});

test('equal event and job timestamps cannot establish that a revoked review was evaluated', t => {
  const f = fixture(t);
  for (const job of Object.values(f.state.jobs)) job.started_at = f.state.trigger.created_at;
  const result = f.runCli();
  assert.equal(result.status, 0);
  assert.equal(result.api.writes.length, 2);
});

test('a cancelled approval job that never started can be refreshed safely', t => {
  const f = fixture(t); f.state.jobs[100].started_at = null; f.state.jobs[100].conclusion = 'cancelled';
  const result = f.runCli();
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.api.writes.length, 2);
});

test('a recently cancelled job has not established a current approval verdict', t => {
  const f = fixture(t); f.state.jobs[100].started_at = new Date().toISOString(); f.state.jobs[100].conclusion = 'cancelled';
  const result = f.runCli();
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.api.writes.length, 2);
});

test('dismissed and edited reviews refresh previously successful jobs without manufacturing a passing verdict', t => {
  for (const action of ['dismissed', 'edited']) {
    const f = fixture(t); f.state.trigger.display_title = `factory-review-event:7:${f.head}:${f.base}:${action}`;
    f.state.reviews[0].state = 'DISMISSED';
    for (const job of Object.values(f.state.jobs)) job.conclusion = 'success';
    const result = f.runCli();
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.api.writes.length, 2);
    assert.equal(result.report.results.some(result => result.status === 'passed'), false);
  }
});

test('unauthorized actors, forged events, stale identities and unrelated jobs never obtain refresh writes', t => {
  for (const kind of ['actor', 'bot', 'author', 'read-only', 'event', 'repository', 'old-head', 'old-base', 'stale-head', 'stale-base', 'foreign-job', 'foreign-workflow', 'fork', 'unbound-run']) {
    const f = fixture(t);
    if (kind === 'actor') f.state.trigger.actor.login = 'unauthorized';
    if (kind === 'bot') f.state.trigger.actor.type = 'Bot';
    if (kind === 'author') f.state.pr.user.login = 'aaron-howard';
    if (kind === 'read-only') f.state.permission = 'read';
    if (kind === 'event') f.state.trigger.event = 'workflow_dispatch';
    if (kind === 'repository') f.state.trigger.repository.full_name = 'org/other';
    if (kind === 'old-head') f.state.pr.head.sha = 'd'.repeat(40);
    if (kind === 'old-base') f.state.pr.base.sha = 'd'.repeat(40);
    if (kind === 'stale-head') f.state.stale = true;
    if (kind === 'stale-base') f.state.staleBase = true;
    if (kind === 'foreign-job') f.state.jobs[101].head_sha = 'd'.repeat(40);
    if (kind === 'foreign-workflow') f.state.runs[1].path = '.github/workflows/release.yml';
    if (kind === 'fork') f.state.pr.head.repo.full_name = 'foreign/repo';
    if (kind === 'unbound-run') f.state.runs[0].display_title = 'Legacy unbound run';
    const result = f.runCli();
    assert.equal(result.status, 1, kind + ': ' + result.stdout);
    assert.equal(result.report.outcome, 'blocked', kind);
    assert.deepEqual(result.api.writes ?? [], [], kind);
  }
});

test('inspection makes no remote writes and a denied rerun cannot be mistaken for success', t => {
  const inspected = fixture(t).runCli('inspect');
  assert.equal(inspected.status, 0);
  assert.equal(inspected.report.outcome, 'ready');
  assert.deepEqual(inspected.api.writes ?? [], []);
  const f = fixture(t); f.state.writeDenied = true;
  const denied = f.runCli(); assert.equal(denied.status, 1);
  assert.equal(denied.report.outcome, 'blocked');
  assert.equal(denied.report.results.some(result => result.status === 'passed'), false);
});
