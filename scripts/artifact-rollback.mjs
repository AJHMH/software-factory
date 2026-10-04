import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { rawGit } from './coverage-evaluation.mjs';

/** @typedef {Record<string, any>} Json */
/** @param {Buffer|string} bytes */
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const tag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
/** @param {string} path */
function bytes(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('unsafe-file');
  return readFileSync(path);
}
/** @param {string} path @returns {Json} */
function json(path) {
  const value = JSON.parse(bytes(path).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-evidence');
  return value;
}
/** @param {string} path @param {Json} value */
function atomic(path, value) {
  if (existsSync(path)) bytes(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try { renameSync(temporary, path); } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
/** @param {string} directory @param {string} path */
function contained(directory, path) {
  const delta = relative(directory, realpathSync(path));
  if (!delta || isAbsolute(delta) || delta === '..' || delta.startsWith(`..${sep}`)) throw new Error('unsafe-state-path');
}
/** Restore immutable packages through the reference adapter; never execute workload code.
 * @param {Record<string,string>} options
 * @returns {Json & {operation:string,outcome:string,results:Array<{capability:string,status:string,required:boolean,reason:string}>}}
 */
export function rollbackArtifact(options) {
  const started = Date.now();
  /** @type {Json} */ const evidence = {};
  /** @type {Json[]} */ const metrics = [{ name: 'rollback.started', at: new Date(started).toISOString() }];
  let lockFd;
  let lockPath = '';
  let attemptPath = '';
  let state = '';
  let attempted = false;
  let switched = false;
  const report = (/** @type {string} */ outcome, /** @type {string} */ reason) => ({ operation: 'rollback', outcome, evidence, metrics: [...metrics, { name: `rollback.${outcome}`, at: new Date().toISOString(), durationMs: Date.now() - started }], escalation: outcome === 'escalated' ? { required: true, reason, runbook: 'docs/runbooks/deployment-rollback.md' } : undefined, results: [{ capability: 'artifact-rollback', required: true, status: outcome === 'restored' || outcome === 'not-required' || outcome === 'eligible' ? 'passed' : 'failed', reason }] });
  try {
    const trustedRepo = realpathSync(resolve(options['--trusted-repo'] ?? '.'));
    const revision = options['--trusted-revision'];
    const repository = options['--repository'];
    const environment = options['--environment'];
    if (!sha.test(revision ?? '') || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !['evaluate', 'apply'].includes(options['--mode'])) throw new Error('invalid-request');
    const policyFile = (/** @type {string} */ name) => parse(rawGit(trustedRepo, ['show', `${revision}:policies/${name}.yaml`]));
    const policy = policyFile('rollback')?.rollback;
    const deployment = policyFile('deployment')?.deployment;
    const actors = policyFile('release')?.release?.authorization?.authorized_actors;
    if (!policy || policy.enabled !== true || policy.adapter !== 'filesystem-reference-v1' || deployment?.adapter !== policy.adapter || policy.environment !== environment || !deployment.environments?.[environment]?.enabled) throw new Error('unsupported-rollback');
    for (const key of ['consecutive_failures', 'max_health_age_seconds', 'timeout_seconds']) if (!Number.isSafeInteger(policy[key]) || policy[key] < 1) throw new Error('invalid-policy');
    if (policy.max_attempts_per_deployment !== 1 || !Array.isArray(policy.allowed_migration_strategies) || policy.allowed_migration_strategies.length !== 1 || policy.allowed_migration_strategies[0] !== 'none') throw new Error('invalid-policy');
    if (!Array.isArray(actors) || !actors.includes(options['--actor'])) throw new Error('unauthorized-actor');
    evidence.trustedRevision = revision;
    evidence.policyDigest = digest(rawGit(trustedRepo, ['show', `${revision}:policies/rollback.yaml`]));
    const deadline = started + policy.timeout_seconds * 1000;
    const checkDeadline = () => { if (Date.now() >= deadline) throw new Error('timeout-breach'); };
    if (!options['--state-directory']) throw new Error('missing-state');
    state = realpathSync(resolve(options['--state-directory']));
    const delta = relative(trustedRepo, state);
    if (!delta || !isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`)) throw new Error('state-inside-source');
    lockPath = join(state, '.promotion.lock');
    try { lockFd = openSync(lockPath, 'wx', 0o600); }
    catch (error) { throw new Error(/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST' ? 'lock-contention' : 'lock-acquisition-failed'); }
    const current = json(join(state, 'current.json'));
    const receiptPath = resolve(options['--deployment-receipt'] ?? '');
    contained(state, receiptPath);
    const receipt = json(receiptPath);
    if (receipt.schemaVersion !== 1 || receipt.repository?.toLowerCase() !== repository.toLowerCase() || receipt.environment !== environment || receipt.adapter !== policy.adapter || receipt.outcome !== 'success' || !tag.test(receipt.tag ?? '') || !sha.test(receipt.sourceRevision ?? '') || !hash.test(receipt.artifactDigest ?? '') || !hash.test(receipt.sbomDigest ?? '') || !/^\d{1,20}$/.test(receipt.approval?.runId ?? '') || !Number.isFinite(Date.parse(receipt.deployedAt))) throw new Error('invalid-deployment-evidence');
    evidence.repository = repository; evidence.environment = environment;
    evidence.deploymentId = receipt.approval.runId; evidence.failedArtifactDigest = receipt.artifactDigest;
    attemptPath = join(state, `rollback-${receipt.approval.runId}.json`);
    if (existsSync(attemptPath)) throw new Error('rollback-already-attempted');
    if (current.environment !== environment || current.outcome !== 'success' || current.tag !== receipt.tag || current.deploymentId !== receipt.approval.runId || current.artifactDigest !== receipt.artifactDigest || current.sourceRevision !== receipt.sourceRevision) throw new Error('stale-deployment');
    const health = json(resolve(options['--health-evidence'] ?? ''));
    const observation = health.evidence, correlation = observation?.deployment;
    const observedAt = Date.parse(observation?.observedAt);
    if (health.schemaVersion !== 1 || health.operation !== 'health-monitoring' || health.simulated !== false || observation?.repository?.toLowerCase() !== repository.toLowerCase() || !correlation || correlation.environment !== environment || correlation.deploymentId !== current.deploymentId || correlation.artifactDigest !== current.artifactDigest || correlation.sourceRevision !== current.sourceRevision || !Number.isFinite(observedAt) || observedAt < Date.parse(receipt.deployedAt) || observedAt > started || started - observedAt > policy.max_health_age_seconds * 1000) throw new Error('uncorrelated-health-evidence');
    if (health.outcome !== 'failed' || !['failed', 'timeout'].includes(observation.probe?.status) || !Number.isSafeInteger(observation.consecutiveFailures) || observation.consecutiveFailures < 0) throw new Error('unsupported-failure-evidence');
    evidence.consecutiveFailures = observation.consecutiveFailures; evidence.observedAt = observation.observedAt;
    if (observation.consecutiveFailures < policy.consecutive_failures) return report('not-required', 'failure-threshold-not-met');
    if (receipt.migrationCompatibility?.strategy !== 'none' || receipt.migrationCompatibility?.compatibleWithPrevious !== true) throw new Error('migration-incompatible-or-unknown');
    const previous = receipt.previousStable;
    if (!previous || previous.environment !== environment || previous.outcome !== 'success' || !tag.test(previous.tag ?? '') || previous.tag === receipt.tag || !hash.test(previous.artifactDigest ?? '') || !sha.test(previous.sourceRevision ?? '')) throw new Error('missing-previous-artifact');
    const assets = join(state, 'releases', previous.tag);
    contained(state, assets);
    const priorReceipt = json(join(assets, 'promotion-receipt.json'));
    if (priorReceipt.repository?.toLowerCase() !== repository.toLowerCase() || priorReceipt.environment !== environment || priorReceipt.outcome !== 'success' || priorReceipt.tag !== previous.tag || priorReceipt.sourceRevision !== previous.sourceRevision || priorReceipt.artifactDigest !== previous.artifactDigest || priorReceipt.approval?.runId !== String(previous.deploymentId) || priorReceipt.migrationCompatibility?.strategy !== 'none' || priorReceipt.migrationCompatibility?.compatibleWithPrevious !== true) throw new Error('invalid-previous-deployment');
    const verify = () => {
      for (const name of ['reference-workload.mjs', 'sbom.spdx.json', 'release-certificate.json', 'release-manifest.json']) contained(assets, join(assets, name));
      const artifact = bytes(join(assets, 'reference-workload.mjs')), sbom = bytes(join(assets, 'sbom.spdx.json')), certificateBytes = bytes(join(assets, 'release-certificate.json'));
      const certificate = json(join(assets, 'release-certificate.json')), manifest = json(join(assets, 'release-manifest.json'));
      if (digest(artifact) !== previous.artifactDigest || digest(sbom) !== priorReceipt.sbomDigest || digest(certificateBytes) !== priorReceipt.certificateDigest || certificate.schemaVersion !== 1 || certificate.operation !== 'certify' || certificate.outcome !== 'certified' || certificate.repository?.toLowerCase() !== repository.toLowerCase() || certificate.revision !== previous.sourceRevision || certificate.artifact?.sha256 !== previous.artifactDigest || certificate.artifact?.sbomSha256 !== priorReceipt.sbomDigest || manifest.tag !== previous.tag || manifest.sourceRevision !== previous.sourceRevision || manifest.repository?.toLowerCase() !== repository.toLowerCase() || manifest.certification?.sha256 !== priorReceipt.certificateDigest || manifest.certification?.artifactSha256 !== previous.artifactDigest || manifest.certification?.sbomSha256 !== priorReceipt.sbomDigest || manifest.migrationCompatibility?.strategy !== 'none' || manifest.migrationCompatibility?.compatibleWithPrevious !== true) throw new Error('artifact-verification-failed');
    };
    verify(); checkDeadline();
    evidence.previousArtifactDigest = previous.artifactDigest;
    if (options['--mode'] === 'evaluate') return report('eligible', 'compatible-previous-package-verified');
    atomic(attemptPath, { schemaVersion: 1, ...evidence, outcome: 'started', startedAt: new Date(started).toISOString() });
    attempted = true;
    atomic(join(state, 'current.json'), { ...previous, sbomDigest: priorReceipt.sbomDigest, deploymentId: String(previous.deploymentId), restoredFromDeployment: current.deploymentId, deployedAt: new Date().toISOString() });
    switched = true;
    verify(); checkDeadline();
    const restored = json(join(state, 'current.json'));
    if (restored.tag !== previous.tag || restored.artifactDigest !== previous.artifactDigest || restored.sourceRevision !== previous.sourceRevision) throw new Error('recovery-verification-failed');
    metrics.push({ name: 'rollback.recovery_verified', at: new Date().toISOString(), adapter: policy.adapter });
    const result = { ...report('restored', 'previous-reference-package-restored'), restored, recovery: { status: 'passed', checks: ['artifact-digest', 'sbom-digest', 'certificate-binding', 'current-package-identity'], runtimeHealth: 'unsupported' } };
    atomic(attemptPath, { schemaVersion: 1, ...result });
    return result;
  } catch (error) {
    // Error messages and paths can contain credentials; publish only fixed reason codes.
    const reason = error instanceof Error && /^[a-z]+(?:-[a-z]+)+$/.test(error.message) ? error.message : 'rollback-evidence-or-adapter-error';
    const result = { ...report('escalated', reason), packageSwitched: switched };
    if (attempted) { try { atomic(attemptPath, { schemaVersion: 1, ...result }); } catch { /* A started record still prevents repeat execution. */ } }
    return result;
  } finally {
    if (lockFd !== undefined) { closeSync(lockFd); unlinkSync(lockPath); }
  }
}
