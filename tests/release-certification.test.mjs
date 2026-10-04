import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parse } from 'yaml';
import { certifyRelease } from '../scripts/release-certification.mjs';

const root = process.cwd();
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const token = process.env.FACTORY_GITHUB_TOKEN;
process.env.FACTORY_GITHUB_TOKEN = 'test-token';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const tmp = mkdtempSync(join(root, 'tmp/release-certification-'));
test.after(() => { rmSync(tmp, { recursive: true, force: true }); if (token === undefined) delete process.env.FACTORY_GITHUB_TOKEN; else process.env.FACTORY_GITHUB_TOKEN = token; });

const policySource = path => spawnSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8' }).stdout;
const checks = parse(policySource('policies/governance.yaml')).governance.repository_protection.required_checks;
const dependencyPolicy = parse(policySource('policies/dependencies.yaml')).dependencies;
function report(operation, properties = {}) {
  const name = operation === 'policy' ? 'policy-review' : operation === 'coverage' ? 'coverage-lines' : operation === 'security' ? 'secret-scanning' : operation === 'sast' ? 'sast-policy' : 'install';
  return { operation, outcome: 'passed', revision, trustedRevision: revision, evidenceDigest: sha256(operation), contractDigest: sha256('contract'),
    qualityDigest: sha256('quality'), policyDigest: sha256('policy'), results: [{ capability: name, required: true, status: 'passed' }], ...properties };
}
function fixture(overrides = {}) {
  const evidence = { version: '1.0', revision, reports: {
    validation: report('validate'), policy: report('policy'), coverage: report('coverage', { baseRevision: revision }), security: report('security'), sast: report('sast'),
    human_review: report('human-review', { repository: 'AJHMH/software-factory', pullRequest: 1, requiredApprovals: 1, approvals: [{ id: 17, login: 'aaron-howard', revision }], changesRequested: [] }),
  }, ...overrides };
  const file = join(tmp, `evidence-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(evidence));
  const responses = new Map([
    [`/repos/AJHMH/software-factory/pulls/1`, { state: 'closed', merged: true, head: { sha: revision }, base: { ref: 'main', sha: revision }, user: { login: 'factory-bot' } }],
    [`/repos/AJHMH/software-factory/commits/${revision}/check-runs?filter=latest&per_page=100`, { check_runs: checks.map(check => ({ name: check.context, app: { id: check.integration_id }, head_sha: revision, status: 'completed', conclusion: 'success' })) }],
    [`/repos/AJHMH/software-factory/pulls/1/reviews?per_page=100`, [{ id: 17, state: 'APPROVED', commit_id: revision, submitted_at: '2026-10-04T12:00:00Z', user: { login: 'aaron-howard', type: 'User' } }]],
    [`/repos/AJHMH/software-factory/issues?state=open&per_page=100`, []],
    [`/repos/AJHMH/software-factory/collaborators/aaron-howard/permission`, { permission: 'write' }],
  ]);
  const fetchImpl = async url => {
    const value = responses.get(url.pathname + url.search);
    if (value === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => value };
  };
  const options = { '--repository': 'AJHMH/software-factory', '--pull-request': '1', '--trusted-repo': root, '--trusted-revision': revision, '--evidence': file, '--artifact-directory': tmp };
  const dependencies = {
    fetchImpl,
    collectGovernance: async () => ({ outcome: 'passed', enforcementEvidence: 'live GitHub ruleset configuration; runtime authorization is not certified', policyDigest: sha256('governance') }),
    releaseArtifact: async () => ({ outcome: 'passed', artifactDigest: sha256('artifact'), sbomDigest: sha256('sbom'), validationEvidenceDigest: sha256(JSON.stringify(evidence.reports.validation)), dependencyCount: 3,
      dependencySource: { ecosystem: 'npm', registry: dependencyPolicy.artifact.dependency_registry, lockfile: dependencyPolicy.artifact.source_lockfile, lockfileVersion: dependencyPolicy.artifact.lockfile_version, includesDevelopmentDependencies: true, packageCount: 3 } }),
  };
  return { evidence, responses, options, dependencies };
}

test('public certification reports pass only after all same-revision evidence and live hosted gates pass', async () => {
  const f = fixture(), output = join(tmp, 'release-certificate.json'); f.options['--output'] = output;
  const certificate = await certifyRelease(f.options, f.dependencies);
  assert.equal(certificate.outcome, 'certified');
  assert.equal(certificate.revision, revision);
  assert.equal(certificate.approvers[0].revision, revision);
  assert.equal(certificate.artifact.sbomSha256, sha256('sbom'));
  assert.equal(certificate.gateEvidence.coverage.baseRevision, revision);
  assert.equal(certificate.releasePolicy.maximumMediumDefects, 5);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).outcome, 'certified');
});

test('a stale gate report blocks certification', async () => {
  const stale = '0'.repeat(40), f = fixture();
  f.evidence.reports.security.revision = stale; writeFileSync(f.options['--evidence'], JSON.stringify(f.evidence));
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /security evidence.*revision/i);
});

test('a passed report with no gate results blocks certification', async () => {
  const f = fixture();
  f.evidence.reports.security.results = [];
  writeFileSync(f.options['--evidence'], JSON.stringify(f.evidence));
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /evidence bundle is malformed or incomplete/i);
});

test('missing required hosted check blocks certification', async () => {
  const f = fixture(), path = `/repos/AJHMH/software-factory/commits/${revision}/check-runs?filter=latest&per_page=100`;
  f.responses.set(path, { check_runs: [] });
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /Required GitHub check/);
});

test('defects with missing severity metadata block certification', async () => {
  const f = fixture(); f.responses.set('/repos/AJHMH/software-factory/issues?state=open&per_page=100', [{ number: 9, labels: [{ name: 'defect' }] }]);
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /lacks exactly one supported severity/);
});

test('defects above the trusted severity limit block certification', async () => {
  const f = fixture(); f.responses.set('/repos/AJHMH/software-factory/issues?state=open&per_page=100', [{ number: 10, labels: [{ name: 'defect' }, { name: 'severity:high' }] }]);
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /Open defect counts exceed/);
});

test('requested changes block certification even when an approval exists', async () => {
  const f = fixture(); f.responses.set('/repos/AJHMH/software-factory/pulls/1/reviews?per_page=100', [
    { id: 17, state: 'APPROVED', commit_id: revision, submitted_at: '2026-10-04T12:00:00Z', user: { login: 'aaron-howard', type: 'User' } },
    { id: 18, state: 'CHANGES_REQUESTED', commit_id: revision, submitted_at: '2026-10-04T12:01:00Z', user: { login: 'aaron-howard', type: 'User' } },
  ]);
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /human review requirements/);
});

test('an unmerged pull request blocks release certification', async () => {
  const f = fixture(); f.responses.set('/repos/AJHMH/software-factory/pulls/1', { state: 'open', merged: false, head: { sha: revision }, base: { ref: 'main', sha: revision }, user: { login: 'factory-bot' } });
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /must be merged into main/);
});

test('coverage against a different pull request base blocks certification', async () => {
  const f = fixture();
  f.responses.set('/repos/AJHMH/software-factory/pulls/1', { state: 'closed', merged: true, head: { sha: revision }, base: { ref: 'main', sha: '0'.repeat(40) }, user: { login: 'factory-bot' } });
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /baseline does not match the pull request base/);
});

test('expired exception evidence blocks certification', async () => {
  const f = fixture();
  f.evidence.reports.policy.exceptions = [{ id: 'old-exception', evidenceId: 'approval-1', approver: 'policy-owner', expiresAt: '2020-01-01T00:00:00.000Z' }];
  writeFileSync(f.options['--evidence'], JSON.stringify(f.evidence));
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /exception evidence.*expired/i);
});

test('missing verified registry and dependency-source metadata blocks certification', async () => {
  const f = fixture(); f.dependencies.releaseArtifact = async () => ({ outcome: 'passed', artifactDigest: sha256('artifact'), sbomDigest: sha256('sbom'), validationEvidenceDigest: sha256(JSON.stringify(f.evidence.reports.validation)), dependencyCount: 3 });
  const result = await certifyRelease(f.options, f.dependencies);
  assert.equal(result.outcome, 'blocked'); assert.match(result.results[0].reason, /Registry, lockfile, or dependency-source metadata/);
});
