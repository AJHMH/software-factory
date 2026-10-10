import { readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { rawGit } from './coverage-evaluation.mjs';
import { digest, document, evaluatePolicy } from './policy-evaluation.mjs';
import { runContract } from './contract-execution.mjs';

/** @typedef {Record<string, any>} Json */
const sha = /^[a-f0-9]{40}$/;
/** Resolve policy only from the executing Factory's pinned checkout and approved consumer pin.
 * @param {Record<string,string>} options
 */
export function distributionContext(options) {
  const factoryRepo = realpathSync(resolve(options['--trusted-repo'] ?? '.'));
  const consumerRepo = realpathSync(resolve(options['--consumer-repo'] ?? ''));
  const revision = options['--trusted-revision'];
  const repository = options['--factory-repository'];
  if (!sha.test(revision ?? '') || revision !== options['--approved-revision']) throw new Error('Factory revision must be a full SHA matching the independently approved distribution pin.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || factoryRepo === consumerRepo) throw new Error('Separate Factory and consumer checkouts and a Factory repository identity are required.');
  if (rawGit(factoryRepo, ['rev-parse', 'HEAD']).trim() !== revision) throw new Error('Factory checkout does not match the executing workflow revision.');
  const sourceRevision = rawGit(consumerRepo, ['rev-parse', 'HEAD']).trim();
  if (options['--source-revision'] && options['--source-revision'] !== sourceRevision) throw new Error('Consumer checkout is not the exact requested source revision.');
  const manifest = parse(rawGit(factoryRepo, ['show', `${revision}:factory-distribution.yaml`]));
  if (manifest?.schema_version !== 1 || !/^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(manifest.version ?? '') || manifest.contract_version !== '1.0' || manifest.policy_pack !== 'baseline-1' || manifest.profiles?.['node-24']?.node_major !== '24' || manifest.profiles['node-24'].artifact_adapter !== 'single-module-npm-v1' || manifest.entry_points?.validation !== '.github/workflows/factory-consumer-validation.yml' || manifest.entry_points?.certification !== '.github/workflows/factory-consumer-certification.yml') throw new Error('Unsupported Factory distribution version or profile manifest.');
  const readConsumer = (/** @type {string} */ path) => {
    const committed = rawGit(consumerRepo, ['show', `${sourceRevision}:${path}`]);
    if (readFileSync(join(consumerRepo, path), 'utf8') !== committed) throw new Error('Consumer adoption files differ from their committed revision.');
    return committed;
  };
  const lock = parse(readConsumer('factory.lock.yaml'));
  if (lock?.schema_version !== 1 || lock.factory?.repository !== repository || lock.factory.revision !== revision || lock.factory.version !== manifest.version || lock.factory.policy_pack !== manifest.policy_pack || !['node-24', 'node-24-typescript-cli'].includes(lock.factory.profile)) throw new Error('Consumer version, profile, policy pack, or immutable Factory pin has drifted.');
  const selectedProfile = manifest.profiles[lock.factory.profile];
  const adapter = lock.factory.profile === 'node-24' ? 'single-module-npm-v1' : 'typescript-cli-npm-v1';
  if (selectedProfile?.node_major !== '24' || selectedProfile.artifact_adapter !== adapter) throw new Error('Unsupported consumer artifact adapter.');
  const contractPath = join(consumerRepo, 'factory-contract.yaml');
  const contract = /** @type {import('./contract-execution.mjs').Contract} */ (document('factory-contract', readConsumer('factory-contract.yaml')));
  if (contract.contract.profile !== lock.factory.profile || contract.version !== manifest.contract_version || process.versions.node.split('.')[0] !== '24') throw new Error('Unsupported contract/runtime/profile combination; this distribution requires Node 24 and contract 1.0.');
  const workflow = parse(readConsumer('.github/workflows/factory-adoption.yml'));
  for (const [job, entry] of Object.entries(manifest.entry_points)) {
    const call = workflow?.jobs?.[job];
    if (call?.uses !== `${repository}/${entry}@${revision}` || (call['continue-on-error'] !== undefined && call['continue-on-error'] !== false)) throw new Error(`Consumer ${job} entry point is not enforced at the immutable Factory revision.`);
    if (job === 'validation' && call.if !== undefined && call.if !== "github.event_name != 'workflow_dispatch'") throw new Error('Consumer validation cannot be skipped by a custom condition.');
  }
  const requiredPolicyFiles = ['policies/enforcement.yaml', 'policies/governance.yaml', 'policies/human-review.yaml', 'policies/quality.yaml', 'policies/security.yaml', 'policies/dependencies.yaml', 'profiles/workloads.yaml'];
  if (JSON.stringify(manifest.policy_files) !== JSON.stringify(requiredPolicyFiles)) throw new Error('Distribution policy pack is incomplete or unsupported.');
  const policyDigest = digest(JSON.stringify(requiredPolicyFiles.map(path => [path, rawGit(factoryRepo, ['show', `${revision}:${path}`])])));
  return { factoryRepo, consumerRepo, revision, repository, sourceRevision, manifest, contract, contractPath, policyDigest };
}

/** @param {Record<string,string>} options */
export async function distributeFactory(options) {
  try {
    if (!['inspect', 'validate'].includes(options['--mode'])) throw new Error('Use distribution mode inspect or validate.');
    const ctx = distributionContext(options);
    const policy = evaluatePolicy({ '--trusted-repo': ctx.factoryRepo, '--trusted-revision': ctx.revision, '--contract': ctx.contractPath });
    if (policy.outcome !== 'passed') return { ...policy, operation: 'distribution' };
    const validation = options['--mode'] === 'validate' ? await runContract(ctx.contractPath) : undefined;
    const report = { operation: 'distribution', outcome: validation?.outcome ?? 'passed', mode: options['--mode'], revision: ctx.sourceRevision, workloadId: ctx.contract.contract.workload_id,
      factory: { repository: ctx.repository, revision: ctx.revision, version: ctx.manifest.version, policyPack: ctx.manifest.policy_pack, policyDigest: ctx.policyDigest, profile: ctx.contract.contract.profile }, policy, ...(validation ? { validation } : {}),
      results: validation?.results ?? [{ capability: 'versioned-factory-distribution', required: true, status: 'passed', reason: 'Committed consumer calls, runtime, profile, and policy pack match the independently approved immutable Factory revision; workload commands were not executed.' }] };
    if (options['--output']) {
      // Output belongs to the Factory runner's private scratch area, not consumer source.
      const output = resolve(options['--output']); mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify({ schemaVersion: 1, ...report }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    return report;
  } catch (error) {
    return { operation: 'distribution', outcome: 'blocked', results: [{ capability: 'versioned-factory-distribution', required: true, status: 'failed', reason: error instanceof Error ? error.message : 'Factory adoption evidence is invalid.' }] };
  }
}
