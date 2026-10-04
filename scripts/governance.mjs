import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { git, digest } from './policy-evaluation.mjs';

/** @typedef {{context:string,integration_id:number}} Check */
/** @typedef {{type:string,parameters?:Record<string,any>}} Rule */
/** @typedef {{id?:number,name:string,target:string,source_type?:string,enforcement:string,bypass_actors:unknown[],conditions:{ref_name:{include:string[],exclude:string[]}},rules:Rule[]}} Ruleset */
/** @typedef {{repository:string,default_branch:string,rulesets:Ruleset[]}} Snapshot */
const managedName='Factory governed default branch';
/** @param {Record<string,string>} options */
function authority(options) {
  const sha=options['--trusted-revision'];
  if(!/^[a-f0-9]{40}$/.test(sha ?? '') || git(options['--trusted-repo'] ?? '.',['cat-file','-t',sha]) !== 'commit') throw new Error('A full trusted Governance commit is required.');
  const source=git(options['--trusted-repo'] ?? '.',['show',`${sha}:policies/governance.yaml`]),policy=parse(source)?.governance?.repository_protection;
  if(!Number.isInteger(policy?.minimum_approvals) || policy.minimum_approvals < 1 || policy.minimum_approvals > 6 || !Array.isArray(policy.required_checks) || !policy.required_checks.length || policy.required_checks.some((/** @type {Check} */ c)=>typeof c.context !== 'string' || !c.context.trim() || !Number.isInteger(c.integration_id) || c.integration_id < 1) || new Set(policy.required_checks.map((/** @type {Check} */ c)=>c.context)).size !== policy.required_checks.length || Object.keys(policy).some(k=>!['minimum_approvals','required_checks'].includes(k))) throw new Error('Invalid authoritative Governance protection policy.');
  return {sha,policyDigest:digest(source),minimum:/** @type {number} */(policy.minimum_approvals),checks:/** @type {Check[]} */(policy.required_checks)};
}
/** @param {string} pattern @param {string} ref */
function matches(pattern,ref) {
  if(pattern === '~ALL' || pattern === '~DEFAULT_BRANCH') return true;
  return new RegExp('^'+pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(ref);
}
/** @param {Snapshot} snapshot @param {ReturnType<typeof authority>} policy */
function differences(snapshot,policy) {
  if(!snapshot || typeof snapshot.default_branch !== 'string' || !snapshot.default_branch || !Array.isArray(snapshot.rulesets)) throw new Error('Incomplete Governance snapshot.');
  const active=snapshot.rulesets.filter(r=>{
    if(typeof r.name !== 'string' || !Array.isArray(r.rules) || !Array.isArray(r.bypass_actors) || !Array.isArray(r.conditions?.ref_name?.include) || !Array.isArray(r.conditions?.ref_name?.exclude)) throw new Error('Malformed ruleset evidence.');
    return r.target === 'branch' && r.enforcement === 'active' && !r.bypass_actors.length && r.conditions.ref_name.include.some(p=>matches(p,`refs/heads/${snapshot.default_branch}`)) && !r.conditions.ref_name.exclude.some(p=>matches(p,`refs/heads/${snapshot.default_branch}`));
  });
  const rules=active.flatMap(r=>r.rules),drift=[];
  for(const type of ['deletion','non_fast_forward','required_signatures','required_linear_history']) if(!rules.some(r=>r.type === type)) drift.push(`Add active ${type} protection for the default branch with no bypass actors.`);
  const prs=rules.filter(r=>r.type === 'pull_request').map(r=>r.parameters);
  if(!prs.some(p=>Number.isInteger(p?.required_approving_review_count) && p?.required_approving_review_count >= policy.minimum)) drift.push(`Require at least ${policy.minimum} human approval(s).`);
  if(!prs.some(p=>p?.dismiss_stale_reviews_on_push === true)) drift.push('Dismiss approvals when commits change.');
  if(!prs.some(p=>p?.required_review_thread_resolution === true)) drift.push('Require review thread resolution.');
  for(const check of policy.checks) if(!rules.some(r=>r.type === 'required_status_checks' && r.parameters?.strict_required_status_checks_policy === true && r.parameters?.do_not_enforce_on_create === false && Array.isArray(r.parameters?.required_status_checks) && r.parameters.required_status_checks.some((/** @type {Check} */ c)=>c.context === check.context && c.integration_id === check.integration_id))) drift.push(`Require up-to-date check "${check.context}" from integration ${check.integration_id}.`);
  return drift;
}
/** @param {Record<string,string>} options @param {Snapshot} snapshot @param {boolean} live */
function report(options,snapshot,live) {
  const policy=authority(options);
  if(snapshot.repository.toLowerCase() !== options['--repository']?.toLowerCase()) throw new Error('Repository evidence identity mismatch.');
  const drift=differences(snapshot,policy);
  return {operation:'governance',outcome:drift.length?'blocked':'passed',repository:snapshot.repository,trustedRevision:policy.sha,policyDigest:policy.policyDigest,drift,enforcementEvidence:live?'live GitHub ruleset configuration; runtime authorization is not certified':'supplied snapshot; live enforcement not established',results:[{capability:'repository-governance',required:true,status:drift.length?'failed':'passed',reason:drift.join(' ') || 'Default branch rulesets satisfy authoritative Governance controls.'}]};
}
/** @param {unknown} error */
function failure(error) {return {operation:'governance',outcome:'blocked',results:[{capability:'repository-governance',required:true,status:'error',reason:error instanceof Error?error.message:'Governance check failed.'}]};}
/** @param {Record<string,string>} options */
export function evaluateGovernance(options) {
  try{return report(options,JSON.parse(readFileSync(options['--evidence'],'utf8')),false);}catch(error){return failure(error);}
}
/** @param {string} path @param {string} method @param {unknown} body */
async function api(path,method='GET',body=undefined) {
  if(!process.env.FACTORY_GITHUB_TOKEN) throw new Error('GitHub token missing; drift needs read access and bootstrap requires repository administration write.');
  const response=await fetch(`https://api.github.com/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${process.env.FACTORY_GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok) throw new Error(`GitHub returned ${response.status}; verify repository access, administration permission, and ruleset entitlement. Enforcement is not established.`);
  return response.json();
}
/** @param {string} repository @returns {Promise<Snapshot>} */
async function collect(repository) {
  const repo=await api(`repos/${repository}`),rulesets=[];
  for(let page=1;page<=100;page++) {
    const list=await api(`repos/${repository}/rulesets?includes_parents=true&per_page=100&page=${page}`);
    if(!Array.isArray(list)) throw new Error('Incomplete ruleset listing.');
    for(const item of list) rulesets.push(await api(item.source_type === 'Organization'?`orgs/${item.source}/rulesets/${item.id}`:`repos/${repository}/rulesets/${item.id}`));
    if(list.length < 100) return {repository:repo.full_name,default_branch:repo.default_branch,rulesets};
  }
  throw new Error('Ruleset pagination exceeded supported bounds.');
}
/** @param {Record<string,string>} options */
export async function collectGovernance(options) {
  try {
    const repository=options['--repository'];
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Invalid repository.');
    const policy=authority(options),before=await collect(repository);
    if(options['--apply'] !== undefined && options['--apply'] !== 'true') throw new Error('Bootstrap requires explicit --apply true.');
    if(options['--apply'] === 'true') {
      const owned=before.rulesets.filter(r=>r.name === managedName && r.source_type === 'Repository');
      if(owned.length > 1) throw new Error('Ambiguous managed rulesets; resolve duplicates before bootstrap.');
      const existing=owned[0],rules=structuredClone(existing?.rules ?? []);
      for(const type of ['deletion','non_fast_forward','required_signatures','required_linear_history']) if(!rules.some(r=>r.type === type)) rules.push({type});
      const pr=rules.find(r=>r.type === 'pull_request') ?? {type:'pull_request',parameters:{}};
      if(!rules.includes(pr)) rules.push(pr);
      pr.parameters={...pr.parameters,required_approving_review_count:Math.max(pr.parameters?.required_approving_review_count ?? 0,policy.minimum),dismiss_stale_reviews_on_push:true,required_review_thread_resolution:true};
      const checks=rules.find(r=>r.type === 'required_status_checks') ?? {type:'required_status_checks',parameters:{}};
      if(!rules.includes(checks)) rules.push(checks);
      const merged=/** @type {Check[]} */(structuredClone(checks.parameters?.required_status_checks ?? []));
      for(const check of policy.checks) {const index=merged.findIndex(c=>c.context === check.context);if(index<0) merged.push(check);else merged[index]=check;}
      checks.parameters={...checks.parameters,strict_required_status_checks_policy:true,do_not_enforce_on_create:false,required_status_checks:merged};
      await api(`repos/${repository}/rulesets${existing?'/'+existing.id:''}`,existing?'PUT':'POST',{name:managedName,target:'branch',enforcement:'active',bypass_actors:[],conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules});
    }
    return report(options,options['--apply'] === 'true'?await collect(repository):before,true);
  } catch(error){return failure(error);}
}
