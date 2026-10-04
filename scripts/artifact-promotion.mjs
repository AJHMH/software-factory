import Ajv from 'ajv';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { rawGit } from './coverage-evaluation.mjs';

/** @typedef {Record<string, any>} Json */
/** @typedef {Json & {operation:string,outcome:string,results:Array<{capability:string,status:string,required:boolean,reason:string}>}} PromotionReport */
/** @param {string|Buffer} value */
const sha256 = value => createHash('sha256').update(value).digest('hex');
/** @param {unknown} value */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
/** @param {string} reason @param {string} [environment] @returns {PromotionReport} */
const blocked = (reason, environment = '') => ({ operation: 'promote', outcome: 'blocked', environment: environment || undefined,
  metrics: [{ name: 'promotion.started', at: new Date().toISOString() }, { name: 'promotion.denied', at: new Date().toISOString() }],
  results: [{ capability: 'artifact-promotion', required: true, status: 'failed', reason }] });
/** @param {string} repository @param {string[]} args */
function git(repository, args) { return rawGit(repository, args).trim(); }
/** @param {string} path @returns {Json} */
function jsonFile(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Expected a regular, non-linked JSON file.');
  const value = /** @type {Json} */ (JSON.parse(readFileSync(path, 'utf8')));
  if (!object(value)) throw new Error('Expected a JSON object.');
  return value;
}
/** @param {string} path */
function regularBytes(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Release asset must be a regular, non-linked file.');
  return readFileSync(path);
}
/** @param {string} path @param {Json} value */
function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}
/** @param {Record<string,string>} options @param {string} stateDirectory @param {string} environment @returns {Json|null} */
function priorState(options, stateDirectory, environment) {
  const supplied = options['--previous-stable'];
  if (supplied) {
    const previous = jsonFile(resolve(supplied));
    if (previous.environment !== environment || previous.outcome !== 'success' || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(previous.tag ?? '') ||
      !shaPattern.test(previous.sourceRevision ?? '') || !digestPattern.test(previous.artifactDigest ?? '') || !/^\d{1,20}$/.test(String(previous.deploymentId ?? ''))) {
      throw new Error('Previous stable deployment evidence is malformed or for a different environment.');
    }
    return previous;
  }
  const currentPath = join(stateDirectory, 'current.json');
  if (!existsSync(currentPath)) return null;
  const current = jsonFile(currentPath);
  if (current.environment !== environment || current.outcome !== 'success' || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(current.tag ?? '') ||
    !shaPattern.test(current.sourceRevision ?? '') || !digestPattern.test(current.artifactDigest ?? '')) throw new Error('Current stable deployment record is invalid.');
  return { environment, outcome: 'success', tag: current.tag, version: current.version, sourceRevision: current.sourceRevision, artifactDigest: current.artifactDigest, deploymentId: current.deploymentId ?? '0' };
}

/** Promote only a previously released and certified bundle into the configured reference adapter.
 * @param {Record<string,string>} options
 * @returns {PromotionReport}
 */
export function promoteArtifact(options) {
  /** @type {Json[]} */ const events = [{ name: 'promotion.started', at: new Date().toISOString() }];
  let stateDirectory = '';
  let lockPath = '';
  let lockFd;
  let staging = '';
  let environment = options['--environment'] ?? '';
  try {
    const repository = options['--repository'], actor = options['--actor'], trustedRevision = options['--trusted-revision'];
    const trustedRepo = realpathSync(resolve(options['--trusted-repo'] ?? '.'));
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !shaPattern.test(trustedRevision ?? '') || git(trustedRepo, ['cat-file', '-t', trustedRevision]) !== 'commit') throw new Error('Repository and exact trusted policy revision are required.');
    const deploymentPolicy = /** @type {Json} */ (parse(git(trustedRepo, ['show', `${trustedRevision}:policies/deployment.yaml`])));
    const deploymentSchema = JSON.parse(readFileSync(new URL('../schemas/deployment-policy.schema.json', import.meta.url), 'utf8'));
    if (!new Ajv.default({ allErrors: true, strict: true }).compile(deploymentSchema)(deploymentPolicy)) throw new Error('Trusted deployment policy is malformed or unsupported.');
    const releasePolicy = parse(git(trustedRepo, ['show', `${trustedRevision}:policies/release.yaml`]))?.release;
    if (!Array.isArray(releasePolicy?.authorization?.authorized_actors) || !releasePolicy.authorization.authorized_actors.includes(actor ?? '')) throw new Error('The requesting actor is not authorized for promotion.');
    const policy = deploymentPolicy.deployment, environmentPolicy = Object.hasOwn(policy.environments, environment) ? policy.environments[environment] : undefined;
    if (!environmentPolicy?.enabled) throw new Error('The requested deployment environment is not configured or enabled.');
    if (policy.workflow !== '.github/workflows/factory-promote-reference.yml' || policy.approval_provider !== 'github-environment-protection' || !environmentPolicy.approval_required) throw new Error('Trusted policy does not require the supported GitHub environment approval gate.');

    const approval = jsonFile(resolve(options['--approval-evidence'] ?? ''));
    const approvalSchema = JSON.parse(readFileSync(new URL('../schemas/promotion-approval.schema.json', import.meta.url), 'utf8'));
    if (!new Ajv.default({ allErrors: true, strict: true }).compile(approvalSchema)(approval)) throw new Error('GitHub environment approval evidence is malformed.');
    if (approval.gate !== 'approved' || approval.gateSource !== policy.approval_provider) throw new Error('GitHub environment approval has not been granted.');
    if (approval.repository.toLowerCase() !== repository.toLowerCase() || approval.environment !== environment || approval.workflow !== policy.workflow || approval.trustedRevision !== trustedRevision || approval.actor !== actor) {
      throw new Error('GitHub environment approval does not match the repository, environment, workflow, trusted revision, or actor.');
    }

    const manifest = jsonFile(resolve(options['--release-manifest'] ?? ''));
    const certificatePath = resolve(options['--certificate'] ?? ''), certificateBytes = regularBytes(certificatePath), certificate = JSON.parse(certificateBytes.toString('utf8'));
    if (!object(certificate) || certificate.schemaVersion !== 1 || certificate.operation !== 'certify' || certificate.outcome !== 'certified' ||
      certificate.repository?.toLowerCase() !== repository.toLowerCase() || !shaPattern.test(certificate.revision ?? '') ||
      !digestPattern.test(certificate.artifact?.sha256 ?? '') || !digestPattern.test(certificate.artifact?.sbomSha256 ?? '')) throw new Error('A successfully certified release for this repository is required.');
    const version = manifest.version;
    if (manifest.schemaVersion !== 1 || manifest.repository?.toLowerCase() !== repository.toLowerCase() || !Array.isArray(version) || version.length !== 3 ||
      version.some(number => !Number.isSafeInteger(number) || number < 0) || manifest.tag !== `v${version.join('.')}` ||
      !shaPattern.test(manifest.sourceRevision ?? '') || git(trustedRepo, ['cat-file', '-t', manifest.sourceRevision]) !== 'commit' ||
      certificate.revision !== manifest.sourceRevision || certificate.revision !== manifest.sourceRevision ||
      !object(manifest.certification) || manifest.certification.sha256 !== sha256(certificateBytes) ||
      manifest.certification.artifactSha256 !== certificate.artifact.sha256 || manifest.certification.sbomSha256 !== certificate.artifact.sbomSha256) {
      throw new Error('Release manifest, certificate, repository, version, or source revision do not match.');
    }
    const migration = manifest.migrationCompatibility;
    if (!object(migration) || typeof migration.compatibleWithPrevious !== 'boolean' || !environmentPolicy.migration.allowed_strategies.includes(migration.strategy)) throw new Error('Release migration compatibility does not match trusted environment policy.');
    const artifactDirectory = resolve(options['--artifact-directory'] ?? ''), requiredAssets = environmentPolicy.health.required_assets;
    const assetBytes = new Map(requiredAssets.map(/** @param {string} name */ name => [name, regularBytes(join(artifactDirectory, name))]));
    const artifact = assetBytes.get('reference-workload.mjs'), sbom = assetBytes.get('sbom.spdx.json');
    if (!artifact || !sbom || environmentPolicy.health.verify_artifact_digest && sha256(artifact) !== certificate.artifact.sha256 ||
      environmentPolicy.health.verify_sbom_digest && sha256(sbom) !== certificate.artifact.sbomSha256 ||
      environmentPolicy.health.verify_certificate_binding && sha256(certificateBytes) !== manifest.certification.sha256) throw new Error('The release artifact failed configured integrity or health checks.');
    events.push({ name: 'artifact.verified', at: new Date().toISOString(), artifactDigest: sha256(artifact), sbomDigest: sha256(sbom) });

    stateDirectory = resolve(options['--state-directory'] ?? '');
    if (!options['--state-directory']) throw new Error('An external deployment state directory is required.');
    mkdirSync(stateDirectory, { recursive: true });
    stateDirectory = realpathSync(stateDirectory);
    const fromRepo = relative(trustedRepo, stateDirectory);
    if (fromRepo === '' || !isAbsolute(fromRepo) && fromRepo !== '..' && !fromRepo.startsWith(`..${sep}`)) throw new Error('Deployment state must be stored outside the source repository.');
    lockPath = join(stateDirectory, '.promotion.lock');
    lockFd = openSync(lockPath, 'wx', 0o600);
    const previousStable = priorState(options, stateDirectory, environment);
    const releasesDirectory = join(stateDirectory, 'releases'), destination = join(releasesDirectory, manifest.tag);
    if (existsSync(destination)) throw new Error(`Release ${manifest.tag} was already promoted to ${environment}.`);
    mkdirSync(releasesDirectory, { recursive: true });
    const runId = approval.runId;
    staging = join(releasesDirectory, `.staging-${manifest.tag}-${runId}`);
    if (existsSync(staging)) throw new Error('A conflicting promotion is already staged.');
    mkdirSync(staging, { mode: 0o700 });
    for (const name of requiredAssets) copyFileSync(join(artifactDirectory, name), join(staging, name), constants.COPYFILE_EXCL);
    const stagedArtifact = regularBytes(join(staging, 'reference-workload.mjs'));
    const stagedSbom = regularBytes(join(staging, 'sbom.spdx.json'));
    if (sha256(stagedArtifact) !== certificate.artifact.sha256 || sha256(stagedSbom) !== certificate.artifact.sbomSha256) throw new Error('Staged release bytes failed the configured health check.');
    const now = new Date().toISOString();
    events.push({ name: 'promotion.health_check', at: now, status: 'passed' });
    /** @type {Json} */ const receipt = {
      schemaVersion: 1,
      repository,
      environment,
      adapter: policy.adapter,
      tag: manifest.tag,
      version: version.join('.'),
      sourceRevision: manifest.sourceRevision,
      artifactDigest: certificate.artifact.sha256,
      sbomDigest: certificate.artifact.sbomSha256,
      certificateDigest: manifest.certification.sha256,
      previousStable,
      approval: { provider: policy.approval_provider, environment, workflow: policy.workflow, runId, actor },
      health: { status: 'passed', checks: ['artifact-digest', 'sbom-digest', 'manifest-certificate-binding'] },
      migrationCompatibility: migration,
      outcome: 'success',
      deployedAt: now,
    };
    events.push({ name: 'promotion.completed', at: new Date().toISOString(), outcome: 'success', environment, version: receipt.version, artifactDigest: receipt.artifactDigest });
    receipt.metrics = events;
    writeFileSync(join(staging, 'promotion-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(staging, destination);
    staging = '';
    atomicJson(join(stateDirectory, 'current.json'), { environment, outcome: 'success', tag: receipt.tag, version: receipt.version, sourceRevision: receipt.sourceRevision, artifactDigest: receipt.artifactDigest, sbomDigest: receipt.sbomDigest, deploymentId: runId, deployedAt: receipt.deployedAt });
    return { operation: 'promote', outcome: 'promoted', repository, actor, approval: receipt.approval, adapter: receipt.adapter, environment, tag: receipt.tag, version: receipt.version, revision: receipt.sourceRevision,
      artifactDigest: receipt.artifactDigest, sbomDigest: receipt.sbomDigest, previousStable, health: receipt.health, migrationCompatibility: migration,
      metrics: events, receiptPath: join(destination, 'promotion-receipt.json'), artifactPath: destination,
      results: [{ capability: 'artifact-promotion', required: true, status: 'passed', reason: `The exact certified ${receipt.tag} artifact passed reference health checks and was promoted through ${policy.adapter}.` }] };
  } catch (error) {
    if (staging && existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    const report = blocked(error instanceof Error ? error.message : 'Promotion was denied by trusted deployment policy.', environment);
    report.metrics = [...events, ...report.metrics.slice(1)];
    return report;
  } finally {
    if (lockFd !== undefined) {
      closeSync(lockFd);
      if (lockPath && existsSync(lockPath)) rmSync(lockPath, { force: true });
    }
  }
}
