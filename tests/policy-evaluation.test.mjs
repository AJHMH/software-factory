import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts/factory-validation.mjs');
function fixture(t) {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const directory = mkdtempSync(join(root, 'tmp/policy-'));
  t.after(() => {
    const target = realpathSync(directory);
    const within = relative(realpathSync(join(root, 'tmp')), target);
    assert.ok(within && within !== '..' && !within.startsWith('..' + sep) && !isAbsolute(within));
    rmSync(target, { recursive: true, force: true });
  });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (name, data) => writeFileSync(join(directory, name), JSON.stringify(data));
  mkdirSync(join(directory, 'policies'));
  mkdirSync(join(directory, 'profiles'));
  const policy = { version: '1.0', maximum_command_timeout_seconds: 300, exception_approvers: ['governance-owner'], approvals: [] };
  const profiles = { version: '1.0', profiles: [{ id: 'node-24', maximum_command_timeout_seconds: 120 }] };
  const contract = { version: '1.0', contract: { workload_id: 'test-workload', profile: 'node-24', working_directory: '.', commands: Object.fromEntries(['install', 'validate', 'test', 'build'].map(name => [name, { run: 'exit 0', timeout_seconds: 120 }])) } };
  write('policies/enforcement.yaml', policy);
  write('profiles/workloads.yaml', profiles);
  write('factory-contract.yaml', contract);
  git('init');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'trusted policy');
  let trustedRevision = git('rev-parse', 'HEAD');
  const revision = trustedRevision;
  const pin = () => {
    write('policies/enforcement.yaml', policy);
    write('profiles/workloads.yaml', profiles);
    git('add', 'policies', 'profiles');
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'approved policy');
    trustedRevision = git('rev-parse', 'HEAD');
  };
  const run = (...extra) => {
    const result = spawnSync(process.execPath, [cli, 'policy', '--contract', join(directory, 'factory-contract.yaml'), '--trusted-repo', directory, '--trusted-revision', trustedRevision, ...extra], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
    return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
  };
  const exception = { id: 'temporary-timeout', rule: 'maximum_command_timeout_seconds', value: 300, workload_id: 'test-workload', profile: 'node-24', revision,
    contract_digest: createHash('sha256').update(JSON.stringify(contract)).digest('hex'), reason: 'Temporary slower validation host', owner: 'workload-owner', approver: 'governance-owner',
    expires_at: new Date(Date.now() + 86400000).toISOString(), evidence_id: 'approval-1' };
  const approve = () => {
    const overrides = { version: '1.0', exceptions: [exception] };
    write('overrides.yaml', overrides);
    policy.approvals = [{ evidence_id: exception.evidence_id, approver: exception.approver, exception_digest: createHash('sha256').update(JSON.stringify(exception)).digest('hex'), approved_at: new Date().toISOString() }];
    pin();
    // Candidate revision is independently selected; restore its HEAD after pinning trusted governance.
    git('checkout', '--detach', revision);
    return join(directory, 'overrides.yaml');
  };
  return { directory, policy, profiles, contract, write, git, trustedRevision, revision, run, pin, exception, approve };
}

test('policy evaluation selects a pinned committed policy and applies the stricter profile limit', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.outcome, 'passed');
  assert.equal(result.report.trustedRevision, f.trustedRevision);
  assert.equal(result.report.effectivePolicy.maximum_command_timeout_seconds, 120);
  assert.equal(result.report.results[0].status, 'passed');
});

test('a proposed policy cannot weaken its own trusted timeout limit', (t) => {
  const f = fixture(t);
  f.policy.maximum_command_timeout_seconds = 600;
  f.profiles.profiles[0].maximum_command_timeout_seconds = 600;
  f.write('policies/enforcement.yaml', f.policy);
  f.write('profiles/workloads.yaml', f.profiles);
  f.contract.contract.commands.test.timeout_seconds = 400;
  f.write('factory-contract.yaml', f.contract);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.report.results[0].reason, /exceeds trusted policy/);
});

test('an independently approved exact-scope exception can relax the profile limit', (t) => {
  const f = fixture(t);
  f.contract.contract.commands.test.timeout_seconds = 240;
  f.write('factory-contract.yaml', f.contract);
  f.exception.contract_digest = createHash('sha256').update(JSON.stringify(f.contract)).digest('hex');
  const path = f.approve();
  const result = f.run('--overrides', path);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.effectivePolicy.maximum_command_timeout_seconds, 300);
  assert.equal(result.report.exceptions[0].evidenceId, 'approval-1');
});

test('exceptions must have current independent approval and exact workload scope', (t) => {
  const cases = [
    ['expired', e => { e.expires_at = new Date(Date.now() - 86400000).toISOString(); }],
    ['too long', e => { e.expires_at = new Date(Date.now() + 40 * 86400000).toISOString(); }],
    ['invalid calendar', e => { e.expires_at = '2099-02-31T00:00:00.000Z'; }],
    ['wrong workload', e => { e.workload_id = 'other'; }],
    ['wrong revision', e => { e.revision = 'a'.repeat(40); }],
    ['wrong contract', e => { e.contract_digest = 'a'.repeat(64); }],
    ['self approval', e => { e.owner = e.approver; }],
    ['case variant self approval', e => { e.owner = e.approver.toUpperCase(); }],
    ['unknown approver', e => { e.approver = 'untrusted-user'; }],
  ];
  for (const [name, mutate] of cases) {
    const f = fixture(t);
    mutate(f.exception);
    const path = f.approve();
    const result = f.run('--overrides', path);
    assert.equal(result.status, 1, name);
    assert.equal(result.report.outcome, 'blocked', name);
  }
});

test('candidate approvals and altered or conflicting exceptions cannot authorize an override', (t) => {
  for (const scenario of ['unapproved', 'altered', 'conflicting', 'future approval', 'duplicate evidence']) {
    const f = fixture(t);
    let path;
    if (scenario === 'unapproved') {
      f.write('overrides.yaml', { version: '1.0', exceptions: [f.exception] });
      f.policy.approvals = [{ evidence_id: 'approval-1', approver: f.exception.approver, exception_digest: createHash('sha256').update(JSON.stringify(f.exception)).digest('hex'), approved_at: new Date().toISOString() }];
      f.write('policies/enforcement.yaml', f.policy);
      path = join(f.directory, 'overrides.yaml');
    } else {
      path = f.approve();
      if (scenario === 'altered') {
        f.exception.value = 600;
        f.write('overrides.yaml', { version: '1.0', exceptions: [f.exception] });
      } else if (scenario === 'conflicting') {
        f.write('overrides.yaml', { version: '1.0', exceptions: [f.exception, { ...f.exception, id: 'other' }] });
      } else {
        if (scenario === 'future approval') f.policy.approvals[0].approved_at = new Date(Date.now() + 3600000).toISOString();
        else f.policy.approvals.push({ ...f.policy.approvals[0] });
        f.pin();
        f.git('checkout', '--detach', f.revision);
      }
    }
    const result = f.run('--overrides', path);
    assert.equal(result.status, 1, scenario);
    assert.equal(result.report.outcome, 'blocked', scenario);
  }
});

test('policy, profile, and exception schemas reject malformed and unsupported values', (t) => {
  for (const scenario of ['policy version', 'policy unknown field', 'policy type', 'profile version', 'unknown profile', 'duplicate profile', 'missing exception owner', 'blank reason', 'unknown exception rule', 'exception type']) {
    const f = fixture(t);
    let extra = [];
    if (scenario.startsWith('policy')) {
      if (scenario === 'policy version') f.policy.version = 2;
      if (scenario === 'policy unknown field') f.policy.allow_all = true;
      if (scenario === 'policy type') f.policy.maximum_command_timeout_seconds = '300';
      f.pin();
    } else if (scenario.includes('profile')) {
      if (scenario === 'profile version') f.profiles.version = '2.0';
      if (scenario === 'unknown profile') f.profiles.profiles[0].id = 'python';
      if (scenario === 'duplicate profile') f.profiles.profiles.push({ ...f.profiles.profiles[0] });
      f.pin();
    } else {
      if (scenario === 'missing exception owner') delete f.exception.owner;
      if (scenario === 'blank reason') f.exception.reason = '  ';
      if (scenario === 'unknown exception rule') f.exception.rule = 'allow_all';
      if (scenario === 'exception type') f.exception.value = '300';
      f.write('overrides.yaml', { version: '1.0', exceptions: [f.exception] });
      extra = ['--overrides', join(f.directory, 'overrides.yaml')];
    }
    const result = f.run(...extra);
    assert.equal(result.status, 1, scenario);
    assert.equal(result.report.outcome, 'blocked', scenario);
  }
  const f = fixture(t);
  assert.equal(f.run('--trusted-revision', 'main').status, 2);
});

test('mutable names and non-commit objects cannot select governing policy', (t) => {
  const f = fixture(t);
  for (const value of ['HEAD', 'main', 'a'.repeat(40), f.git('rev-parse', 'HEAD:policies/enforcement.yaml')]) {
    const result = spawnSync(process.execPath, [cli, 'policy', '--trusted-repo', f.directory, '--trusted-revision', value, '--contract', join(f.directory, 'factory-contract.yaml')], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1, value);
    assert.equal(JSON.parse(result.stdout).outcome, 'blocked');
  }
});
