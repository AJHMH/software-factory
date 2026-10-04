import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const sha256 = value => createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const tempRoot = join(root, 'tmp');
  mkdirSync(tempRoot, { recursive: true });
  const directory = mkdtempSync(join(tempRoot, 'factory-promotion-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const trustedRepo = join(directory, 'trusted-policy');
  mkdirSync(join(trustedRepo, 'policies'), { recursive: true });
  copyFileSync(join(root, 'policies', 'deployment.yaml'), join(trustedRepo, 'policies', 'deployment.yaml'));
  copyFileSync(join(root, 'policies', 'release.yaml'), join(trustedRepo, 'policies', 'release.yaml'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: trustedRepo, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', '-c', 'user.name=Factory Test', '-c', 'user.email=factory-test@example.invalid', 'commit', '-m', 'test policy');
  const trustedRevision = git('rev-parse', 'HEAD');
  const assets = join(directory, 'release-assets');
  mkdirSync(assets);
  const artifact = Buffer.from('export const version = "0.1.1";\n');
  const sbom = Buffer.from('{"spdxVersion":"SPDX-2.3"}\n');
  writeFileSync(join(assets, 'reference-workload.mjs'), artifact);
  writeFileSync(join(assets, 'sbom.spdx.json'), sbom);
  const certificate = {
    schemaVersion: 1,
    operation: 'certify',
    outcome: 'certified',
    repository: 'AJHMH/software-factory',
    revision: trustedRevision,
    artifact: { sha256: sha256(artifact), sbomSha256: sha256(sbom) },
  };
  const certificateBytes = Buffer.from(`${JSON.stringify(certificate, null, 2)}\n`);
  writeFileSync(join(assets, 'release-certificate.json'), certificateBytes);
  const manifest = {
    schemaVersion: 1,
    repository: 'AJHMH/software-factory',
    version: [0, 1, 1],
    tag: 'v0.1.1',
    sourceRevision: trustedRevision,
    certification: {
      sha256: sha256(certificateBytes),
      artifactSha256: sha256(artifact),
      sbomSha256: sha256(sbom),
    },
    migrationCompatibility: { strategy: 'none', compatibleWithPrevious: true },
  };
  writeFileSync(join(assets, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const approval = {
    schemaVersion: 1,
    repository: 'AJHMH/software-factory',
    environment: 'reference',
    gate: 'approved',
    gateSource: 'github-environment-protection',
    workflow: '.github/workflows/factory-promote-reference.yml',
    runId: '37200000000',
    actor: 'aaron-howard',
    trustedRevision,
  };
  const approvalPath = join(directory, 'approval.json');
  writeFileSync(approvalPath, JSON.stringify(approval));
  const options = {
    '--repository': 'AJHMH/software-factory',
    '--trusted-repo': trustedRepo,
    '--trusted-revision': trustedRevision,
    '--actor': 'aaron-howard',
    '--environment': 'reference',
    '--release-manifest': join(assets, 'release-manifest.json'),
    '--certificate': join(assets, 'release-certificate.json'),
    '--artifact-directory': assets,
    '--approval-evidence': approvalPath,
    '--state-directory': join(directory, 'environment-state'),
  };
  const invoke = () => {
    const args = ['scripts/factory-validation.mjs', 'promote', '--mode', 'apply', ...Object.entries(options).flatMap(([key, value]) => [key, value])];
    return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  };
  return { directory, assets, options, approval, invoke };
}

test('the public Factory Validation interface promotes the exact certified artifact and records health, prior state, and metrics', t => {
  const f = fixture(t);
  const result = f.invoke();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'promoted');
  assert.equal(report.environment, 'reference');
  assert.equal(report.artifactDigest, sha256(readFileSync(join(f.assets, 'reference-workload.mjs'))));
  assert.equal(report.previousStable, null);
  assert.deepEqual(report.health, { status: 'passed', checks: ['artifact-digest', 'sbom-digest', 'manifest-certificate-binding'] });
  assert.deepEqual(report.metrics.map(event => event.name), ['promotion.started', 'artifact.verified', 'promotion.health_check', 'promotion.completed']);
  assert.equal(readFileSync(join(f.options['--state-directory'], 'current.json'), 'utf8').includes('v0.1.1'), true);
  assert.equal(readFileSync(join(f.options['--state-directory'], 'releases', 'v0.1.1', 'reference-workload.mjs'), 'utf8'), readFileSync(join(f.assets, 'reference-workload.mjs'), 'utf8'));
});

test('promotion denies absent or mismatched environment approval, actor, certificate, release, and artifact evidence', t => {
  const noApproval = fixture(t);
  noApproval.approval.gate = 'pending';
  writeFileSync(noApproval.options['--approval-evidence'], JSON.stringify(noApproval.approval));
  assert.match(JSON.parse(noApproval.invoke().stdout).results[0].reason, /approval has not been granted/i);

  const wrongEnvironment = fixture(t);
  wrongEnvironment.approval.environment = 'production';
  writeFileSync(wrongEnvironment.options['--approval-evidence'], JSON.stringify(wrongEnvironment.approval));
  assert.match(JSON.parse(wrongEnvironment.invoke().stdout).results[0].reason, /approval does not match/i);

  const unauthorized = fixture(t);
  unauthorized.options['--actor'] = 'untrusted-user';
  assert.match(JSON.parse(unauthorized.invoke().stdout).results[0].reason, /not authorized/i);

  const altered = fixture(t);
  writeFileSync(join(altered.assets, 'reference-workload.mjs'), 'tampered');
  assert.match(JSON.parse(altered.invoke().stdout).results[0].reason, /integrity|health/i);

  const badCertificate = fixture(t);
  const certificatePath = badCertificate.options['--certificate'];
  const certificate = JSON.parse(readFileSync(certificatePath, 'utf8'));
  certificate.outcome = 'blocked';
  writeFileSync(certificatePath, JSON.stringify(certificate));
  assert.match(JSON.parse(badCertificate.invoke().stdout).results[0].reason, /certified release/i);

  const incompatible = fixture(t);
  const manifestPath = incompatible.options['--release-manifest'];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.migrationCompatibility.strategy = 'destructive';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.match(JSON.parse(incompatible.invoke().stdout).results[0].reason, /migration compatibility/i);
});

test('promotion is serialized and refuses a duplicate version without replacing the stable deployment', t => {
  const f = fixture(t);
  const first = f.invoke();
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const currentPath = join(f.options['--state-directory'], 'current.json');
  const original = readFileSync(currentPath, 'utf8');
  const duplicate = f.invoke();
  assert.equal(duplicate.status, 1);
  assert.match(JSON.parse(duplicate.stdout).results[0].reason, /already promoted/i);
  assert.equal(readFileSync(currentPath, 'utf8'), original);
});

test('promotion carries forward the prior stable release from trusted deployment evidence', t => {
  const f = fixture(t);
  const previous = { environment: 'reference', outcome: 'success', tag: 'v0.1.0', version: '0.1.0', sourceRevision: f.options['--trusted-revision'], artifactDigest: 'a'.repeat(64), deploymentId: '37200000001' };
  const previousPath = join(f.directory, 'previous-stable.json');
  writeFileSync(previousPath, JSON.stringify(previous));
  f.options['--previous-stable'] = previousPath;
  const result = f.invoke();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.previousStable, previous);
  assert.deepEqual(JSON.parse(readFileSync(join(f.options['--state-directory'], 'releases', 'v0.1.1', 'promotion-receipt.json'), 'utf8')).previousStable, previous);
});

test('GitHub workflow helper authorizes only eligible main dispatches and writes evidence after the environment gate', t => {
  const f = fixture(t);
  const helper = join(root, 'scripts', 'promotion-workflow.mjs');
  const base = ['--trusted-repo', join(f.directory, 'trusted-policy'), '--trusted-revision', f.options['--trusted-revision'], '--repository', 'AJHMH/software-factory', '--environment', 'reference'];
  const invoke = (command, args, env = process.env) => spawnSync(process.execPath, [helper, command, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  const authorized = invoke('authorize', [...base, '--actor', 'aaron-howard', '--event', 'workflow_dispatch', '--ref', 'refs/heads/main', '--run-attempt', '1', '--source-revision', f.options['--trusted-revision'], '--release-tag', 'v0.1.1']);
  assert.equal(authorized.status, 0, authorized.stderr);
  assert.equal(JSON.parse(authorized.stdout).outcome, 'passed');

  const denied = invoke('authorize', [...base, '--actor', 'aaron-howard', '--event', 'workflow_dispatch', '--ref', 'refs/heads/feature', '--run-attempt', '1', '--source-revision', f.options['--trusted-revision'], '--release-tag', 'v0.1.1']);
  assert.equal(denied.status, 1);

  const evidencePath = join(f.directory, 'workflow-approval.json');
  const approval = invoke('approval', [...base, '--actor', 'aaron-howard', '--source-revision', f.options['--trusted-revision'], '--output', evidencePath], { ...process.env, GITHUB_RUN_ID: '37200000000' });
  assert.equal(approval.status, 0, approval.stderr);
  assert.equal(JSON.parse(readFileSync(evidencePath, 'utf8')).gate, 'approved');
});
