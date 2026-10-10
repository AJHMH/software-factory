import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { securityContext, UnsupportedSecurityCapability } from './security-evaluation.mjs';
import { digest, document, git } from './policy-evaluation.mjs';
import { rawGit } from './coverage-evaluation.mjs';

/** @typedef {{rule:string,severity:'critical'|'high'|'medium'|'low'|'none',path:string,line:number,help_url:string}} Finding */
/** @typedef {{id:number,revision:string,ref:string,language:string,build_mode:string,tool_version:string,rules_count:number,status:'success'|'error'|'unsupported',findings:Finding[]}} Analysis */
/** @typedef {{version:string,revision:string,tree_digest:string,contract_digest:string,workload_id:string,profile:string,analyses:Analysis[]}} Evidence */

/** @param {Record<string,string>} options */
export function sastContext(options) {
  const context=securityContext(options), trustedRepo=options['--trusted-repo'] ?? context.repo;
  const source=rawGit(trustedRepo,['show',`${context.trustedRevision}:policies/security.yaml`]);
  const policy=parse(source)?.security?.sast;
  const severities=['critical','high','medium','low','none'];
  if (!Array.isArray(policy?.block_on_severity) || !Array.isArray(policy?.warn_on_severity) || [...policy.block_on_severity,...policy.warn_on_severity].some(value=>!severities.includes(value)) || new Set([...policy.block_on_severity,...policy.warn_on_severity]).size !== policy.block_on_severity.length + policy.warn_on_severity.length) throw new Error('Invalid trusted SAST severity policy.');
  // Pre-#7 trusted commits have no CodeQL pack: bootstrap only the fixed supported Node profile.
  const profileSource=git(trustedRepo,['ls-tree',context.trustedRevision,'--','profiles/codeql.yaml']) ? rawGit(trustedRepo,['show',`${context.trustedRevision}:profiles/codeql.yaml`]) : 'version: "1.0"\nprofiles:\n  - id: node-24\n    language: javascript-typescript\n    build_mode: none\n    category: /language:javascript-typescript\n';
  const pack=parse(profileSource);
  if (pack?.version !== '1.0' || !Array.isArray(pack.profiles) || pack.profiles.length < 1 || new Set(pack.profiles.map((/** @type {{id:string}} */ p)=>p.id)).size !== pack.profiles.length || Object.keys(pack).some(key=>!['version','profiles'].includes(key))) throw new Error('Invalid trusted CodeQL profile pack.');
  const profile=pack.profiles.find((/** @type {{id:string}} */ p)=>p.id === context.contract.profile);
  if (!profile) throw new UnsupportedSecurityCapability('Unsupported CodeQL profile.');
  if (profile.id !== context.contract.profile || profile.language !== 'javascript-typescript' || profile.build_mode !== 'none' || profile.category !== '/language:javascript-typescript' || Object.keys(profile).some(key=>!['id','language','build_mode','category','analysis_keys'].includes(key))) throw new UnsupportedSecurityCapability('Unsupported CodeQL profile.');
  const analysisKeys=profile.analysis_keys ?? ['dynamic/github-code-scanning/codeql:analyze'];
  if (!Array.isArray(analysisKeys) || !analysisKeys.length || analysisKeys.length > 10 || new Set(analysisKeys).size !== analysisKeys.length || analysisKeys.some(key=>typeof key !== 'string' || !/^(?:dynamic\/github-code-scanning\/codeql:analyze|\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml:[A-Za-z0-9_-]+)$/.test(key))) throw new Error('Invalid trusted CodeQL analysis identities.');
  return {...context,codeql:{...profile,analysis_keys:analysisKeys},block:/** @type {string[]} */(policy.block_on_severity),warn:/** @type {string[]} */(policy.warn_on_severity),sastPolicyDigest:digest(source),profileDigest:digest(profileSource)};
}

/** @param {'error'|'unsupported'} status @param {string} reason */
export function sastError(status='error',reason='CodeQL evidence is missing, malformed, stale, incomplete, or unavailable. Re-run CodeQL for the exact source revision; mandatory SAST did not pass.') {
  return {operation:'sast',outcome:'blocked',results:[{capability:'sast-policy',required:true,status,reason}]};
}

/** @param {Record<string,string>} options @param {Evidence | undefined} supplied */
export function evaluateSast(options,supplied=undefined) {
  try {
    const context=sastContext(options);
    const evidence=/** @type {Evidence} */(document('sast-evidence',supplied ? JSON.stringify(supplied) : readFileSync(options['--evidence'],'utf8')));
    if (evidence.revision !== context.revision || evidence.tree_digest !== context.treeDigest || evidence.contract_digest !== context.contractDigest || evidence.workload_id !== context.contract.workload_id || evidence.profile !== context.contract.profile) throw new Error('Stale evidence.');
    const analysis=evidence.analyses[0];
    if (analysis.revision !== context.revision || analysis.language !== context.codeql.language || analysis.build_mode !== context.codeql.build_mode) throw new Error('Out-of-scope analysis.');
    if (analysis.status !== 'success') return sastError(analysis.status,'CodeQL analysis/build did not complete successfully. Inspect the CodeQL workflow logs and rerun the exact revision.');
    for (const finding of analysis.findings) {
      if (finding.path.includes('\\') || /[\r\n]/.test(finding.path) || finding.path.split('/').some(part=>!part || part === '.' || part === '..') || !/^100(644|755) blob /.test(git(context.repo,['ls-tree',context.revision,'--',finding.path]))) throw new Error('Finding path is not committed.');
      if (finding.line > rawGit(context.repo,['show',`${context.revision}:${finding.path}`]).split('\n').length) throw new Error('Finding line is out of range.');
    }
    const denied=analysis.findings.filter(finding=>context.block.includes(finding.severity));
    const warnings=analysis.findings.filter(finding=>context.warn.includes(finding.severity));
    return {operation:'sast',outcome:denied.length ? 'blocked' : 'passed',revision:context.revision,treeDigest:context.treeDigest,trustedRevision:context.trustedRevision,contractDigest:context.contractDigest,policyDigest:context.sastPolicyDigest,profileDigest:context.profileDigest,evidenceDigest:digest(JSON.stringify(evidence)),analysisId:analysis.id,toolVersion:analysis.tool_version,language:analysis.language,buildMode:analysis.build_mode,findings:analysis.findings,warnings:warnings.length,results:[{capability:'sast-policy',required:true,status:denied.length ? 'failed' : 'passed',reason:`CodeQL completed: ${denied.length} prohibited findings, ${warnings.length} policy warnings. See finding rule/path/line/help URL for remediation.`}]};
  } catch(error) { return sastError(error instanceof UnsupportedSecurityCapability ? 'unsupported' : 'error'); }
}
