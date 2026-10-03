import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, sep, isAbsolute } from 'node:path';
import { parse } from 'yaml';
import { digest, git, document } from './policy-evaluation.mjs';
import { rawGit } from './coverage-evaluation.mjs';
import { versions } from './security-tools.mjs';

export class UnsupportedSecurityCapability extends Error {}

/** @typedef {{path:string,rule:string,line:number,source_digest:string}} SecretFinding */
/** @typedef {{package:string,severity:'info'|'low'|'medium'|'high'|'critical',advisory:string}} DependencyFinding */
/** @template T @typedef {{status:'clean'|'findings'|'error'|'unsupported',exit_code:number|null,findings:T[]}} Scan */
/** @typedef {{version:string,revision:string,tree_digest:string,workload_id:string,profile:string,contract_digest:string,tools:typeof versions,secrets:Scan<SecretFinding>,dependencies:Scan<DependencyFinding>}} Evidence */
/** @param {Record<string,string>} options */
export function securityContext(options) {
  const filename = resolve(options['--contract'] ?? 'factory-contract.yaml');
  const repo = git(dirname(filename), ['rev-parse','--show-toplevel']);
  const revision = git(repo, ['rev-parse','HEAD']);
  const path = relative(repo,filename).split(sep).join('/');
  if (!path || path.startsWith('../') || isAbsolute(path)) throw new Error('Contract is outside repository.');
  const contractSource = rawGit(repo,['show',`${revision}:${path}`]);
  const contract = /** @type {import('./contract-execution.mjs').Contract} */ (document('factory-contract',contractSource)).contract;
  if (contract.profile !== 'node-24') throw new UnsupportedSecurityCapability('Unsupported security workload profile.');
  const prefix = relative(repo,resolve(dirname(filename),contract.working_directory)).split(sep).join('/');
  if (prefix.startsWith('../') || isAbsolute(prefix)) throw new Error('Workload escapes repository.');
  const trustedRevision = options['--trusted-revision'];
  if (!/^[a-f0-9]{40}$/.test(trustedRevision ?? '') || git(options['--trusted-repo'] ?? repo,['cat-file','-t',trustedRevision]) !== 'commit') throw new Error('Pinned trusted commit is required.');
  const trustedRepo = options['--trusted-repo'] ?? repo;
  const policySource = rawGit(trustedRepo,['show',`${trustedRevision}:policies/security.yaml`]);
  const policy = parse(policySource), security = policy?.security;
  const dependencySource = rawGit(trustedRepo,['show',`${trustedRevision}:policies/dependencies.yaml`]);
  const dependencyPolicy = parse(dependencySource), maximum = dependencyPolicy?.dependencies?.vulnerability_threshold?.max_severity_allowed;
  if (![1,'1.0'].includes(policy?.version) || ![1,'1.0'].includes(dependencyPolicy?.version) || typeof security?.secrets?.fail_on_any_secret !== 'boolean' || typeof security?.secrets?.allow_dummy_secrets_in_tests !== 'boolean' || !['info','low','medium','high','critical'].includes(maximum)) throw new Error('Invalid trusted security policy.');
  const ledger = /** @type {import('./policy-evaluation.mjs').Policy} */ (document('factory-policy',rawGit(trustedRepo,['show',`${trustedRevision}:policies/enforcement.yaml`])));
  const approvals = git(trustedRepo,['ls-tree',trustedRevision,'--','policies/security-dummy-approvals.json']) ? parse(rawGit(trustedRepo,['show',`${trustedRevision}:policies/security-dummy-approvals.json`])) : {version:'1.0',approvals:[]};
  if (approvals?.version !== '1.0' || !Array.isArray(approvals.approvals) || Object.keys(approvals).some(key=>!['version','approvals'].includes(key))) throw new Error('Invalid dummy-secret approval ledger.');
  return {repo,revision,contract,prefix,contractDigest:digest(contractSource),treeDigest:git(repo,['rev-parse',`${revision}^{tree}`]),trustedRevision,policyDigest:digest(policySource + '\n' + dependencySource),failSecrets:security.secrets.fail_on_any_secret,allowDummy:security.secrets.allow_dummy_secrets_in_tests,maximum,approvals:approvals.approvals,approvers:ledger.exception_approvers};
}

/** @param {ReturnType<typeof securityContext>} context @param {SecretFinding} finding */
function approvedDummy(context, finding) {
  if (!context.allowDummy || !finding.path.startsWith((context.prefix ? context.prefix + '/' : '') + 'tests/')) return false;
  return context.approvals.some((/** @type {Record<string,unknown>} */ entry) => {
    const required = ['revision','workload_id','path','rule','line','source_digest','owner','approver','reason','approved_at','expires_at'];
    if (Object.keys(entry).length !== required.length || required.some(key=>!Object.hasOwn(entry,key))) throw new Error('Malformed dummy approval.');
    const expires = Date.parse(String(entry.expires_at)), approved = Date.parse(String(entry.approved_at));
    return entry.revision === context.revision && entry.workload_id === context.contract.workload_id && entry.path === finding.path && entry.rule === finding.rule && entry.line === finding.line && entry.source_digest === finding.source_digest && typeof entry.reason === 'string' && entry.reason.trim().length > 0 && typeof entry.owner === 'string' && entry.owner.trim().length > 0 && typeof entry.approver === 'string' && context.approvers.includes(entry.approver) && entry.owner.trim().toLowerCase() !== entry.approver.trim().toLowerCase() && Number.isFinite(expires) && Number.isFinite(approved) && approved <= Date.now() && expires > Date.now() && expires > approved && expires - approved <= 30 * 86400000;
  });
}

/** @param {Scan<unknown>} scan @param {number} findingsCode */
function validScan(scan, findingsCode) {
  return scan.status === 'clean' ? scan.exit_code === 0 && scan.findings.length === 0 : scan.status === 'findings' ? scan.exit_code === findingsCode && scan.findings.length > 0 : false;
}

/** @param {Record<string, string>} options @param {Evidence | undefined} supplied */
export function evaluateSecurity(options, supplied = undefined) {
  try {
    const context = securityContext(options);
    const evidence = /** @type {Evidence} */ (document('security-evidence',supplied ? JSON.stringify(supplied) : readFileSync(options['--evidence'],'utf8')));
    if (evidence.revision !== context.revision || evidence.tree_digest !== context.treeDigest || evidence.workload_id !== context.contract.workload_id || evidence.profile !== context.contract.profile || evidence.contract_digest !== context.contractDigest) throw new Error('Security evidence is stale or out of scope.');
    for (const finding of evidence.secrets.findings) {
      if (finding.path.startsWith('/') || finding.path.includes('\\') || finding.path.split('/').some(part=>!part || part === '.' || part === '..') || /[\r\n]/.test(finding.path)) throw new Error('Invalid finding path.');
      if (!/^100(644|755) blob /.test(git(context.repo,['ls-tree',context.revision,'--',finding.path]))) throw new Error('Finding does not identify a committed regular file.');
      const source = rawGit(context.repo,['show',`${context.revision}:${finding.path}`]);
      if (digest(source) !== finding.source_digest || finding.line > source.split('\n').length) throw new Error('Finding source evidence is stale.');
    }
    const deniedSecrets = evidence.secrets.findings.filter(finding=>!approvedDummy(context,finding));
    const severity = ['info','low','medium','high','critical'];
    const deniedDependencies = evidence.dependencies.findings.filter(finding=>severity.indexOf(finding.severity) > severity.indexOf(context.maximum));
    const results = [
      {capability:'secret-scanning',required:true,status:!validScan(evidence.secrets,10) ? evidence.secrets.status === 'unsupported' ? 'unsupported' : 'error' : context.failSecrets && deniedSecrets.length ? 'failed' : 'passed',reason:`${evidence.secrets.findings.length} redacted secret findings; ${deniedSecrets.length} without scoped dummy approval.`},
      {capability:'dependency-scanning',required:true,status:!validScan(evidence.dependencies,1) ? evidence.dependencies.status === 'unsupported' ? 'unsupported' : 'error' : deniedDependencies.length ? 'failed' : 'passed',reason:`${evidence.dependencies.findings.length} dependency findings; ${deniedDependencies.length} exceed trusted maximum ${context.maximum}.`}
    ];
    return {operation:'security',outcome:results.every(gate=>gate.status === 'passed') ? 'passed' : 'blocked',revision:context.revision,treeDigest:context.treeDigest,trustedRevision:context.trustedRevision,contractDigest:context.contractDigest,policyDigest:context.policyDigest,evidenceDigest:digest(JSON.stringify(evidence)),tools:evidence.tools,findings:{secrets:evidence.secrets.findings,dependencies:evidence.dependencies.findings},results};
  } catch (error) {
    return securityError(error instanceof UnsupportedSecurityCapability ? 'unsupported' : 'error');
  }
}
/** @param {'error'|'unsupported'} status */
export function securityError(status = 'error') { return { operation: 'security', outcome: 'blocked', results: ['secret-scanning','dependency-scanning'].map(capability=>({capability,required:true,status,reason:status === 'unsupported' ? 'Workload, lockfile, or scanner platform is unsupported; mandatory gates cannot pass.' : 'Security evidence or scanner is missing, malformed, stale, or unavailable; no mandatory gate passed.'})) }; }
