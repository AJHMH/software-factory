import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts/factory-validation.mjs');
const hash = text => createHash('sha256').update(text).digest('hex');
function fixture(t) {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const repo = mkdtempSync(join(root, 'tmp/coverage-test-'));
  t.after(() => {
    const target = realpathSync(repo), within = relative(realpathSync(join(root, 'tmp')), target);
    assert.ok(within && within !== '..' && !within.startsWith('..' + sep) && !isAbsolute(within));
    rmSync(target, { recursive: true, force: true });
  });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  const write = (name, value) => writeFileSync(join(repo, name), typeof value === 'string' ? value : JSON.stringify(value));
  for (const name of ['policies', 'profiles', 'workload/src', 'workload/tests/integration']) mkdirSync(join(repo, name), { recursive: true });
  const quality = { version: '1.0', quality: { testing: { coverage_thresholds: { global_minimum_percentage: 80, new_code_minimum_percentage: 90 }, allow_coverage_decrease: false, require_unit_tests: true, require_integration_tests: true }, linting: { treat_warnings_as_errors: true, allow_suppression_comments: false }, release_readiness: { zero_open_defects_severity: 'high', max_open_defects_severity: { medium: 5, low: 20 } } } };
  const policy = { version: '1.0', maximum_command_timeout_seconds: 300, exception_approvers: ['governance-owner'], approvals: [] };
  const contract = { version: '1.0', contract: { workload_id: 'coverage-workload', profile: 'node-24', working_directory: 'workload', commands: Object.fromEntries(['install', 'validate', 'test', 'build'].map(name => [name, { run: 'exit 0', timeout_seconds: 10 }])) } };
  write('policies/quality.yaml', quality); write('policies/enforcement.yaml', policy);
  write('profiles/workloads.yaml', { version: '1.0', profiles: [{ id: 'node-24', maximum_command_timeout_seconds: 120 }] });
  write('factory-contract.yaml', contract);
  const source = Array.from({ length: 10 }, (_, index) => `export const value${index} = ${index};`).join('\n') + '\n';
  write('workload/src/index.mjs', source);
  write('workload/tests/index.test.mjs', "import test from 'node:test'; import assert from 'node:assert/strict'; import { value0 } from '../src/index.mjs'; test('unit', () => assert.equal(value0, 0));\n");
  write('workload/tests/integration/process.test.mjs', "import test from 'node:test'; import assert from 'node:assert/strict'; import { spawnSync } from 'node:child_process'; test('integration', () => { const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'import { value0 } from \\\"./src/index.mjs\\\"; console.log(value0)'], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr || result.stdout); assert.equal(result.stdout.trim(), '0'); });\n".replaceAll('\\"', '"'));
  git('init'); git('add', '.');
  const commit = () => { git('-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-am', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = commit();
  let trustedRevision = base;
  const candidate = source.replace('value9 = 9', 'value9 = 10');
  write('workload/src/index.mjs', candidate);
  const revision = commit();
  const file = text => ({ path: 'workload/src/index.mjs', source_digest: hash(text), lines: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, i < 7 || i === 9 ? 1 : 0])), branches: Array.from({ length: 5 }, (_, i) => ({ id: String(i), line: i === 4 ? 10 : i + 1, end_line: i === 4 ? 10 : i + 1, hits: i === 3 ? 0 : 1 })) });
  const evidence = { version: '1.0', revision, base_revision: base, workload_id: contract.contract.workload_id, profile: 'node-24', contract_digest: hash(JSON.stringify(contract)), files: [file(candidate)], baseline: { revision: base, files: [file(source)] }, tests: Object.fromEntries(['unit', 'integration'].map(name => [name, { revision, status: 'passed', exit_code: 0 }])) };
  const run = (...extra) => {
    write('evidence.json', evidence);
    const result = spawnSync(process.execPath, [cli, 'coverage', '--contract', join(repo, 'factory-contract.yaml'), '--trusted-repo', repo, '--trusted-revision', trustedRevision, '--base-revision', base, '--evidence', join(repo, 'evidence.json'), ...extra], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
    return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
  };
  const approve = exceptions => {
    write('overrides.yaml', { version: '1.0', exceptions });
    policy.approvals = exceptions.map(e => ({ evidence_id: e.evidence_id, approver: e.approver, exception_digest: hash(JSON.stringify(e)), approved_at: new Date().toISOString() }));
    write('policies/enforcement.yaml', policy);
    trustedRevision = commit();
    git('checkout', '--detach', revision);
    return join(repo, 'overrides.yaml');
  };
  const exception = (rule, value) => ({ id: rule, rule, value, base_revision: base, workload_id: contract.contract.workload_id, profile: 'node-24', revision, contract_digest: evidence.contract_digest, reason: 'Temporary legacy test migration', owner: 'workload-owner', approver: 'governance-owner', expires_at: new Date(Date.now() + 86400000).toISOString(), evidence_id: rule });
  return { repo, git, write, commit, policy, quality, contract, source, candidate, base, revision, evidence, run, approve, exception };
}

test('coverage at exact global boundaries with fully covered changed code passes', t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.report.outcome, 'passed');
  assert.equal(result.report.metrics.global.lines.percentage, 80);
  assert.equal(result.report.metrics.global.branches.percentage, 80);
  assert.equal(result.report.metrics.changed.lines.percentage, 100);
  assert.equal(result.report.metrics.changed.branches.percentage, 100);
  assert.ok(result.report.results.some(gate => gate.capability === 'unit-tests' && gate.status === 'passed'));
  assert.ok(result.report.results.some(gate => gate.capability === 'integration-tests' && gate.status === 'passed'));
});

test('inadequate global, changed-code, branch coverage and decreases block the required gate', t => {
  for (const scenario of ['global lines', 'global branches', 'changed lines', 'changed branches', 'line decrease', 'branch decrease']) {
    const f = fixture(t);
    if (scenario === 'global lines') f.evidence.files[0].lines['1'] = 0;
    if (scenario === 'global branches') f.evidence.files[0].branches[0].hits = 0;
    if (scenario === 'changed lines') { f.evidence.files[0].lines['10'] = 0; f.evidence.files[0].lines['8'] = 1; }
    if (scenario === 'changed branches') { f.evidence.files[0].branches[4].hits = 0; f.evidence.files[0].branches[3].hits = 1; }
    if (scenario === 'line decrease') f.evidence.baseline.files[0].lines['8'] = 1;
    if (scenario === 'branch decrease') f.evidence.baseline.files[0].branches[3].hits = 1;
    const result = f.run();
    assert.equal(result.status, 1, scenario);
    assert.ok(result.report.results.some(gate => gate.capability.startsWith('coverage-') && gate.status === 'failed'), scenario);
  }
});

test('the Node adapter collects actual committed baseline/head coverage and separate test results', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [cli, 'measure-coverage', '--contract', join(f.repo, 'factory-contract.yaml'), '--trusted-repo', f.repo, '--trusted-revision', f.base, '--base-revision', f.base, '--output', join(f.repo, 'measured.json')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'passed');
  assert.equal(report.metrics.global.lines.percentage, 100);
  assert.equal(report.metrics.changed.lines.percentage, 100);
  assert.ok(report.results.some(gate => gate.capability === 'unit-tests' && gate.status === 'passed'));
  assert.ok(report.results.some(gate => gate.capability === 'integration-tests' && gate.status === 'passed'));
});

test('missing, malformed, incomplete, or stale evidence cannot pass', t => {
  for (const scenario of ['missing unit', 'failed integration', 'stale tests', 'stale revision', 'stale baseline', 'stale contract', 'wrong profile', 'wrong workload', 'source digest', 'missing line', 'negative hits', 'missing branches', 'duplicate branch', 'outside source', 'extra field']) {
    const f = fixture(t), e = f.evidence;
    if (scenario === 'missing unit') delete e.tests.unit;
    if (scenario === 'failed integration') e.tests.integration = { revision: f.revision, status: 'failed', exit_code: 7 };
    if (scenario === 'stale tests') e.tests.unit.revision = f.base;
    if (scenario === 'stale revision') e.revision = f.base;
    if (scenario === 'stale baseline') e.baseline.revision = f.revision;
    if (scenario === 'stale contract') e.contract_digest = 'a'.repeat(64);
    if (scenario === 'wrong profile') e.profile = 'python';
    if (scenario === 'wrong workload') e.workload_id = 'other-workload';
    if (scenario === 'source digest') e.files[0].source_digest = 'a'.repeat(64);
    if (scenario === 'missing line') delete e.files[0].lines['1'];
    if (scenario === 'negative hits') e.files[0].lines['1'] = -1;
    if (scenario === 'missing branches') e.files[0].branches = [];
    if (scenario === 'duplicate branch') e.files[0].branches.push(e.files[0].branches[0]);
    if (scenario === 'outside source') e.files[0].path = '../secret.mjs';
    if (scenario === 'extra field') e.passed = true;
    assert.equal(f.run().status, 1, scenario);
  }
});

test('changed-code coverage at 90 percent passes and 80 percent fails even when global coverage passes', t => {
  const f = fixture(t);
  const source = f.candidate.replace(/= (\d+);/g, (_, number) => `= ${Number(number) + 100};`);
  f.write('workload/src/index.mjs', source);
  const revision = f.commit();
  f.evidence.revision = revision; f.evidence.files[0].source_digest = hash(source);
  for (const result of Object.values(f.evidence.tests)) result.revision = revision;
  for (const line of Object.keys(f.evidence.files[0].lines)) f.evidence.files[0].lines[line] = line === '1' ? 0 : 1;
  for (const branch of f.evidence.files[0].branches) branch.hits = 1;
  const pass = f.run();
  assert.equal(pass.status, 0, pass.stdout);
  assert.equal(pass.report.metrics.changed.lines.percentage, 90);
  f.evidence.files[0].lines['2'] = 0;
  const fail = f.run();
  assert.equal(fail.status, 1);
  assert.equal(fail.report.metrics.global.lines.percentage, 80);
  assert.equal(fail.report.metrics.changed.lines.percentage, 80);
});

test('only approved exact-scope exceptions can relax coverage requirements', t => {
  const f = fixture(t);
  f.evidence.files[0].lines['1'] = 0;
  const exceptions = [f.exception('coverage.global_minimum_percentage', 60), f.exception('coverage.allow_coverage_decrease', true)];
  f.write('overrides.yaml', { version: '1.0', exceptions });
  assert.equal(f.run('--overrides', join(f.repo, 'overrides.yaml')).status, 1, 'Self-declared approval cannot waive policy.');
  const path = f.approve(exceptions);
  const pass = f.run('--overrides', path);
  assert.equal(pass.status, 0, pass.stdout);
  assert.equal(pass.report.exceptions.length, 2);
  exceptions[0].base_revision = f.revision;
  f.write('overrides.yaml', { version: '1.0', exceptions });
  assert.equal(f.run('--overrides', path).status, 1, 'Approval cannot be reused for another baseline.');
});

test('proposed Quality policy weakening does not affect the governing thresholds', t => {
  const f = fixture(t);
  f.quality.quality.testing.coverage_thresholds.global_minimum_percentage = 0;
  f.quality.quality.testing.allow_coverage_decrease = true;
  f.write('policies/quality.yaml', f.quality);
  f.evidence.files[0].lines['1'] = 0;
  const result = f.run();
  assert.equal(result.status, 1);
  assert.equal(result.report.effectivePolicy.coverage_thresholds.global_minimum_percentage, 80);
});

test('real measurement cannot hide unused source through candidate c8 configuration', t => {
  const f = fixture(t);
  f.write('workload/src/untested.mjs', Array.from({ length: 100 }, (_, i) => `export const unused${i} = ${i};`).join('\n') + '\n');
  f.write('workload/package.json', { private: true, c8: { all: false, include: ['nothing/**'], exclude: ['src/**'] } });
  f.git('add', 'workload'); f.commit();
  const result = spawnSync(process.execPath, [cli, 'measure-coverage', '--contract', join(f.repo, 'factory-contract.yaml'), '--trusted-repo', f.repo, '--trusted-revision', f.base, '--base-revision', f.base], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.metrics.global.lines.total, 110);
  assert.equal(report.metrics.global.lines.covered, 10);
  assert.equal(report.outcome, 'blocked');
});

test('passing unit coverage cannot replace the required integration suite', t => {
  const f = fixture(t);
  f.git('rm', 'workload/tests/integration/process.test.mjs'); f.commit();
  const result = spawnSync(process.execPath, [cli, 'measure-coverage', '--contract', join(f.repo, 'factory-contract.yaml'), '--trusted-repo', f.repo, '--trusted-revision', f.base, '--base-revision', f.base], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.metrics.global.lines.percentage, 100);
  assert.ok(report.results.some(gate => gate.capability === 'unit-tests' && gate.status === 'passed'));
  assert.ok(report.results.some(gate => gate.capability === 'integration-tests' && gate.required && gate.status === 'failed'));
});
