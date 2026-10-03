import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { parse } from 'yaml';

/** @typedef {{evidence_id: string, approver: string, exception_digest: string, approved_at: string}} Approval */
/** @typedef {{version: string, maximum_command_timeout_seconds: number, exception_approvers: string[], approvals: Approval[]}} Policy */
/** @typedef {{version: string, profiles: Array<{id: string, maximum_command_timeout_seconds: number}>}} Profiles */
/** @typedef {{id: string, rule: string, value: number | boolean, workload_id: string, profile: string, revision: string, contract_digest: string, reason: string, owner: string, approver: string, expires_at: string, evidence_id: string}} Exception */

const ajv = new Ajv.default({ strict: true, allErrors: true });
const validators = Object.fromEntries(['factory-policy', 'workload-profiles', 'policy-overrides', 'factory-contract', 'quality-policy', 'coverage-evidence', 'security-evidence', 'sast-evidence'].map(name =>
  [name, ajv.compile(JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8')))]));
/** @param {string} source */
export function digest(source) { return createHash('sha256').update(source).digest('hex'); }
/** @param {string} repo @param {string[]} args */
export function git(repo, args) {
  const result = spawnSync('git', args, { cwd: resolve(repo), encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10000, windowsHide: true });
  if (result.status !== 0) throw new Error('Trusted or workload Git evidence could not be read.');
  return result.stdout.trim();
}
/** @param {string} name @param {string} source @returns {unknown} */
export function document(name, source) {
  const value = parse(source);
  if (!validators[name](value)) throw new Error(`Invalid ${name}: ${ajv.errorsText(validators[name].errors)}`);
  return value;
}

/** Evaluate data only; the trusted revision is selected by the invoking operator, never the candidate. @param {Record<string, string>} options */
export function evaluatePolicy(options) {
  try {
    const trustedRevision = options['--trusted-revision'];
    if (!/^[a-f0-9]{40}$/.test(trustedRevision ?? '')) throw new Error('A full pinned trusted commit SHA is required.');
    const repository = options['--trusted-repo'] ?? '.';
    if (git(repository, ['cat-file', '-t', trustedRevision]) !== 'commit') throw new Error('Trusted revision must identify a commit.');
    const policySource = git(repository, ['show', `${trustedRevision}:policies/enforcement.yaml`]);
    const profileSource = git(repository, ['show', `${trustedRevision}:profiles/workloads.yaml`]);
    const policy = /** @type {Policy} */ (document('factory-policy', policySource));
    const profiles = /** @type {Profiles} */ (document('workload-profiles', profileSource));
    const contractSource = readFileSync(options['--contract'] ?? 'factory-contract.yaml', 'utf8');
    const contract = /** @type {import('./contract-execution.mjs').Contract} */ (document('factory-contract', contractSource)).contract;
    const revision = git(dirname(resolve(options['--contract'] ?? 'factory-contract.yaml')), ['rev-parse', 'HEAD']);
    const selected = profiles.profiles.filter(p => p.id === contract.profile);
    if (selected.length !== 1 || profiles.profiles.length !== new Set(profiles.profiles.map(p => p.id)).size) throw new Error('Profile must be uniquely supported by trusted policy.');
    let maximum = Math.min(policy.maximum_command_timeout_seconds, selected[0].maximum_command_timeout_seconds);
    const contractDigest = digest(contractSource);
    const exceptions = approvedExceptions(options, policy, { revision, contractDigest, workloadId: contract.workload_id, profile: contract.profile });
    for (const exception of exceptions) if (exception.rule === 'maximum_command_timeout_seconds' && typeof exception.value === 'number') maximum = exception.value;
    const failed = Object.values(contract.commands).some(command => command.timeout_seconds > maximum);
    return { operation: 'policy', outcome: failed ? 'blocked' : 'passed', trustedRevision, revision,
      policyDigest: digest(policySource), profileDigest: digest(profileSource), contractDigest,
      workingTreeDirty: git(dirname(resolve(options['--contract'] ?? 'factory-contract.yaml')), ['status', '--porcelain']).length > 0,
      exceptions: exceptions.map(exception => ({ id: exception.id, evidenceId: exception.evidence_id, approver: exception.approver, expiresAt: exception.expires_at })),
      effectivePolicy: { maximum_command_timeout_seconds: maximum },
      results: [{ capability: 'policy-review', status: failed ? 'failed' : 'passed', required: true,
        reason: failed ? 'Command timeout exceeds trusted policy.' : 'Contract execution limits satisfy the trusted policy; no workload commands executed.' }] };
  } catch (error) {
    return { operation: 'policy', outcome: 'blocked', results: [{ capability: 'policy-review', status: 'failed', required: true, reason: error instanceof Error ? error.message : String(error) }] };
  }
}

/** @param {Record<string, string>} options @param {Policy} policy @param {{revision: string, contractDigest: string, workloadId: string, profile: string, baseRevision?: string}} scope @returns {Exception[]} */
export function approvedExceptions(options, policy, scope) {
  const approvalIds = policy.approvals.map(approval => approval.evidence_id);
  if (new Set(approvalIds).size !== approvalIds.length) throw new Error('Conflicting trusted approval evidence.');
  if (!options['--overrides']) return [];
  const overrides = /** @type {{version: string, exceptions: Array<Exception & {base_revision?: string}>}} */ (document('policy-overrides', readFileSync(options['--overrides'], 'utf8')));
  const seen = new Set();
  for (const exception of overrides.exceptions) {
    if (seen.has(exception.rule)) throw new Error('Conflicting exceptions target the same rule.');
    seen.add(exception.rule);
    if (exception.workload_id !== scope.workloadId || exception.profile !== scope.profile || exception.revision !== scope.revision || exception.contract_digest !== scope.contractDigest ||
      (exception.rule.startsWith('coverage.') && scope.baseRevision && exception.base_revision !== scope.baseRevision)) throw new Error('Exception is out of scope for this workload, revision, contract, or coverage baseline.');
    const approval = policy.approvals.find(entry => entry.evidence_id === exception.evidence_id);
    if (!approval || approval.approver !== exception.approver || !policy.exception_approvers.includes(exception.approver) || exception.owner.trim().toLowerCase() === exception.approver.trim().toLowerCase() ||
      approval.exception_digest !== digest(JSON.stringify(exception))) throw new Error('Exception has no independent matching trusted approval evidence.');
    const expires = Date.parse(exception.expires_at), approved = Date.parse(approval.approved_at), now = Date.now();
    if (!Number.isFinite(expires) || !Number.isFinite(approved) || new Date(expires).toISOString() !== exception.expires_at || new Date(approved).toISOString() !== approval.approved_at || expires <= now || approved > now || approved >= expires || expires - approved > 30 * 86400000) throw new Error('Exception approval or expiry is invalid, expired, or exceeds 30 days.');
  }
  return overrides.exceptions;
}
