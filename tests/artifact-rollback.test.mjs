import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = process.cwd();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'factory-rollback-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const trusted = join(directory, 'trusted');
  mkdirSync(join(trusted, 'policies'), { recursive: true });
  for (const name of ['rollback', 'deployment', 'release']) copyFileSync(join(root, `policies/${name}.yaml`), join(trusted, `policies/${name}.yaml`));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: trusted, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init'); git('add', '.');
  git('-c', 'commit.gpgsign=false', '-c', 'user.name=Factory Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'policy');
  const revision = git('rev-parse', 'HEAD');
  const state = join(directory, 'state');
  const nodeArgs = [];
  const invoke = (command, options) => {
    const r = spawnSync(process.execPath, [...nodeArgs, join(root, 'scripts/factory-validation.mjs'), command, ...Object.entries(options).flat()], { cwd: root, encoding: 'utf8' });
    assert.ok(r.stdout.trim(), r.stderr);
    return { status: r.status, report: JSON.parse(r.stdout) };
  };
  const common = { '--trusted-repo': trusted, '--trusted-revision': revision, '--repository': 'owner/repo', '--environment': 'reference', '--actor': 'aaron-howard', '--state-directory': state };
  const promote = (tag, runId) => {
    const assets = join(directory, tag); mkdirSync(assets);
    const artifact = Buffer.from(`export const tag = '${tag}';\n`), sbom = Buffer.from('{}');
    writeFileSync(join(assets, 'reference-workload.mjs'), artifact); writeFileSync(join(assets, 'sbom.spdx.json'), sbom);
    const certificate = { schemaVersion: 1, operation: 'certify', outcome: 'certified', repository: 'owner/repo', revision, artifact: { sha256: hash(artifact), sbomSha256: hash(sbom) } };
    save(join(assets, 'release-certificate.json'), certificate);
    save(join(assets, 'release-manifest.json'), { schemaVersion: 1, repository: 'owner/repo', version: tag.slice(1).split('.').map(Number), tag, sourceRevision: revision, certification: { sha256: hash(readFileSync(join(assets, 'release-certificate.json'))), artifactSha256: hash(artifact), sbomSha256: hash(sbom) }, migrationCompatibility: { strategy: 'none', compatibleWithPrevious: true } });
    const approval = join(directory, 'approval.json');
    save(approval, { schemaVersion: 1, repository: 'owner/repo', environment: 'reference', gate: 'approved', gateSource: 'github-environment-protection', workflow: '.github/workflows/factory-promote-reference.yml', runId, actor: 'aaron-howard', trustedRevision: revision });
    const r = invoke('promote', { ...common, '--mode': 'apply', '--release-manifest': join(assets, 'release-manifest.json'), '--certificate': join(assets, 'release-certificate.json'), '--artifact-directory': assets, '--approval-evidence': approval });
    assert.equal(r.report.outcome, 'promoted', JSON.stringify(r));
    return r.report;
  };
  promote('v1.0.0', '101');
  const deployment = promote('v1.0.1', '102');
  const receipt = join(state, 'releases/v1.0.1/promotion-receipt.json');
  const evidencePath = join(directory, 'health.json');
  const evidence = { schemaVersion: 1, operation: 'health-monitoring', outcome: 'failed', simulated: false, evidence: { repository: 'owner/repo', workloadId: 'service', observedAt: new Date().toISOString(), consecutiveFailures: 3, probe: { status: 'failed' }, deployment: { environment: 'reference', deploymentId: '102', artifactDigest: deployment.artifactDigest, sourceRevision: revision } } };
  const options = { ...common, '--mode': 'apply', '--deployment-receipt': receipt, '--health-evidence': evidencePath };
  const rollback = () => { save(evidencePath, evidence); return invoke('rollback', options); };
  return { directory, state, evidence, options, rollback, receipt, nodeArgs };
}

test('public rollback restores the prior certified package and prevents repeated attempts', t => {
  const f = fixture(t);
  const result = f.rollback();
  assert.equal(result.status, 0);
  assert.equal(result.report.outcome, 'restored');
  assert.equal(result.report.restored.tag, 'v1.0.0');
  assert.equal(result.report.recovery.status, 'passed');
  assert.equal(f.rollback().report.outcome, 'escalated');
});

test('public rollback denies unknown migrations without changing the current package', t => {
  const f = fixture(t);
  const receipt = JSON.parse(readFileSync(f.receipt));
  receipt.migrationCompatibility = { strategy: 'unknown', compatibleWithPrevious: false };
  save(f.receipt, receipt);
  const before = readFileSync(join(f.state, 'current.json'), 'utf8');
  const result = f.rollback();
  assert.equal(result.status, 1);
  assert.equal(result.report.escalation.reason, 'migration-incompatible-or-unknown');
  assert.equal(readFileSync(join(f.state, 'current.json'), 'utf8'), before);
});

test('public rollback escalates tampered previous assets with redacted evidence', t => {
  const f = fixture(t);
  writeFileSync(join(f.state, 'releases/v1.0.0/reference-workload.mjs'), 'secret=do-not-publish');
  const before = readFileSync(join(f.state, 'current.json'), 'utf8');
  const result = f.rollback();
  assert.equal(result.report.outcome, 'escalated');
  assert.equal(result.report.escalation.reason, 'artifact-verification-failed');
  assert.equal(result.report.escalation.runbook, 'docs/runbooks/deployment-rollback.md');
  assert.equal(JSON.stringify(result).includes('do-not-publish'), false);
  assert.equal(readFileSync(join(f.state, 'current.json'), 'utf8'), before);
});

test('health CLI binds failures to deployment identity and resets failures for a new deployment', t => {
  const f = fixture(t);
  const healthState = join(f.directory, 'monitor.json');
  const run = receipt => {
    const r = spawnSync(process.execPath, [join(root, 'scripts/factory-validation.mjs'), 'health-monitoring', '--repository', 'owner/repo', '--workload-id', 'service', '--fixture-result', 'failed', '--state-file', healthState, '--deployment-receipt', receipt], { cwd: root, encoding: 'utf8' });
    assert.ok(r.stdout, r.stderr);
    return JSON.parse(r.stdout);
  };
  const previousReceipt = join(f.state, 'releases/v1.0.0/promotion-receipt.json');
  run(previousReceipt); run(previousReceipt);
  const current = run(f.receipt);
  assert.equal(current.evidence.deployment.deploymentId, '102');
  assert.equal(current.evidence.consecutiveFailures, 1);
});

test('rollback honors thresholds and supports inspection before mutation', t => {
  const f = fixture(t);
  const before = readFileSync(join(f.state, 'current.json'), 'utf8');
  f.evidence.evidence.consecutiveFailures = 2;
  assert.equal(f.rollback().report.outcome, 'not-required');
  f.evidence.evidence.consecutiveFailures = 3;
  f.options['--mode'] = 'evaluate';
  assert.equal(f.rollback().report.outcome, 'eligible');
  assert.equal(readFileSync(join(f.state, 'current.json'), 'utf8'), before);
  f.options['--mode'] = 'apply';
  assert.equal(f.rollback().report.outcome, 'restored');
});

test('rollback escalates missing assets instead of rebuilding or changing source history', t => {
  const f = fixture(t);
  rmSync(join(f.state, 'releases/v1.0.0/reference-workload.mjs'));
  assert.equal(f.rollback().report.outcome, 'escalated');
});

test('rollback rejects stale, uncorrelated, simulated, and unsupported failure evidence', t => {
  const f = fixture(t);
  const before = readFileSync(join(f.state, 'current.json'), 'utf8');
  const original = structuredClone(f.evidence);
  for (const change of [
    value => { value.evidence.deployment.deploymentId = '103'; },
    value => { value.evidence.observedAt = '2000-01-01T00:00:00.000Z'; },
    value => { value.simulated = true; },
    value => { value.evidence.probe.status = 'unknown'; },
  ]) {
    Object.assign(f.evidence, structuredClone(original)); change(f.evidence);
    assert.equal(f.rollback().report.outcome, 'escalated');
    assert.equal(readFileSync(join(f.state, 'current.json'), 'utf8'), before);
  }
});

test('rollback deadline breaches escalate before mutation', t => {
  const f = fixture(t);
  const before = readFileSync(join(f.state, 'current.json'), 'utf8');
  const preload = join(f.directory, 'clock.mjs');
  // Substitute only the clock boundary; exercise the real public CLI and adapter.
  writeFileSync(preload, 'const now = Date.now(); let first = true; Date.now = () => { if (first) { first = false; return now; } return now + 61000; };');
  f.nodeArgs.push('--import', pathToFileURL(preload).href);
  const result = f.rollback();
  assert.equal(result.report.escalation.reason, 'timeout-breach');
  assert.equal(result.report.packageSwitched, false);
  assert.equal(readFileSync(join(f.state, 'current.json'), 'utf8'), before);
});

test('failed recovery verification records the attempted switch and prevents another rollback', t => {
  const f = fixture(t);
  const preload = join(f.directory, 'storage-failure.mjs');
  const active = join(f.state, 'current.json');
  const asset = join(f.state, 'releases/v1.0.0/reference-workload.mjs');
  // Simulate storage corruption at the documented filesystem activation boundary.
  writeFileSync(join(f.directory, 'storage-failure.json'), JSON.stringify({ active, asset }));
  writeFileSync(preload, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; const { active, asset } = JSON.parse(fs.readFileSync(new URL('./storage-failure.json', import.meta.url), 'utf8')); const rename = fs.renameSync; fs.renameSync = (source, target) => { rename(source, target); if (target === active) fs.writeFileSync(asset, 'corrupt'); }; syncBuiltinESMExports();");
  f.nodeArgs.push('--import', pathToFileURL(preload).href);
  const failed = f.rollback();
  assert.equal(failed.report.outcome, 'escalated');
  assert.equal(failed.report.packageSwitched, true);
  assert.equal(failed.report.escalation.reason, 'artifact-verification-failed');
  f.nodeArgs.length = 0;
  assert.equal(f.rollback().report.escalation.reason, 'rollback-already-attempted');
});

test('concurrent promotion or rollback escalates with an actionable contention reason', t => {
  const f = fixture(t);
  writeFileSync(join(f.state, '.promotion.lock'), 'busy');
  const result = f.rollback();
  assert.equal(result.report.escalation.reason, 'lock-contention');
  assert.equal(readFileSync(join(f.state, '.promotion.lock'), 'utf8'), 'busy');
});
