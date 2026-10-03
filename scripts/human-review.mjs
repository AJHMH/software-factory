import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { parse } from 'yaml';
import Ajv from 'ajv';
import { digest, document, git } from './policy-evaluation.mjs';
import { rawGit, evaluateCoverage } from './coverage-evaluation.mjs';

/** @typedef {{id:number,login:string,type:'User'|'Bot',state:string,commit_id:string,submitted_at:string,permission:string}} Review */
/** @typedef {{version:string,repository:string,pull_request:number,revision:string,base_revision:string,author:string,reviews:Review[]}} ReviewEvidence */
/** @typedef {{mandatory_paths:string[],conditional_triggers:{lines_changed_threshold:number,decrease_in_test_coverage:boolean,modifies_database_schema:boolean},approvals_required:{default:number,critical_paths:number},agent_accounts?:string[],human_approvers?:string[]}} ReviewPolicy */
const ajv=new Ajv.default({strict:true,allErrors:true});
const policyValidator=ajv.compile(JSON.parse(readFileSync(new URL('../schemas/human-review-policy.schema.json',import.meta.url),'utf8')));
const evidenceValidator=ajv.compile(JSON.parse(readFileSync(new URL('../schemas/human-review-evidence.schema.json',import.meta.url),'utf8')));

/** @param {Record<string,string>} options */
export function reviewContext(options) {
  const contractPath=resolve(options['--contract'] ?? 'factory-contract.yaml');
  const repo=git(dirname(contractPath),['rev-parse','--show-toplevel']), revision=git(repo,['rev-parse','HEAD']);
  const base=options['--base-revision'], trusted=options['--trusted-revision'], trustedRepo=resolve(options['--trusted-repo'] ?? repo);
  for(const sha of [base,trusted]) if(!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Pinned base and policy commits required.');
  if(git(trustedRepo,['cat-file','-t',trusted]) !== 'commit') throw new Error('Invalid policy commit.');
  rawGit(repo,['merge-base','--is-ancestor',base,revision]);
  const source=rawGit(trustedRepo,['show',`${trusted}:policies/human-review.yaml`]);
  const policyDocument=parse(source);
  if(!policyValidator(policyDocument)) throw new Error('Invalid human-review policy.');
  const policy=/** @type {{human_review:ReviewPolicy}} */(policyDocument).human_review;
  if(policy.approvals_required.critical_paths < policy.approvals_required.default) throw new Error('Critical approvals cannot be weaker than default approvals.');
  const contractRelative=relative(repo,contractPath).split(sep).join('/');
  const contractSource=rawGit(repo,['show',`${revision}:${contractRelative}`]);
  const contract=/** @type {import('./contract-execution.mjs').Contract} */(document('factory-contract',contractSource)).contract;
  if(contract.profile !== 'node-24' || /(^|\/)\.\.(\/|$)|\\/.test(contract.working_directory)) throw new Error('Unsupported workload.');
  const workload=relative(repo,resolve(dirname(contractPath),contract.working_directory)).split(sep).join('/');
  if(workload === '..' || workload.startsWith('../') || workload.startsWith('/')) throw new Error('Unsafe workload.');
  return {repo,revision,base,trusted,trustedRepo,policy,policyDigest:digest(source),contractDigest:digest(contractSource),contractRelative,workload};
}

/** Glob ** matches zero or more directories, * stays inside one component. @param {string} pattern @param {string} path */
function matches(pattern,path) {
  let expression='^';
  for(let index=0;index<pattern.length;index++) {
    if(pattern.slice(index,index+3) === '**/') {expression+='(?:.*/)?';index+=2;}
    else if(pattern.slice(index,index+2) === '**') {expression+='.*';index++;}
    else if(pattern[index] === '*') expression+='[^/]*';
    else expression+=pattern[index].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }
  return new RegExp(expression+'$').test(path);
}

/** @param {string} reason */
export function reviewError(reason='Human approval evidence is missing, malformed, stale, or unavailable. Obtain current independent reviews and re-run the gate.') {
  return {operation:'human-review',outcome:'blocked',results:[{capability:'human-review',required:true,status:'error',reason}]};
}

/** @param {Record<string,string>} options @param {ReviewEvidence | undefined} supplied */
export function evaluateHumanReview(options,supplied=undefined) {
  try {
    const context=reviewContext(options);
    const evidence=/** @type {ReviewEvidence} */(supplied ?? JSON.parse(readFileSync(options['--evidence'],'utf8')));
    if(!evidenceValidator(evidence) || evidence.revision !== context.revision || evidence.base_revision !== context.base || evidence.repository.toLowerCase() !== options['--repository']?.toLowerCase() || String(evidence.pull_request) !== options['--pull-request']) throw new Error('Evidence identity mismatch.');
    const ids=evidence.reviews.map(review=>review.id);
    if(new Set(ids).size !== ids.length) throw new Error('Duplicate reviews.');
    // --no-renames exposes both the removed and added paths, including moves out of sensitive directories.
    const files=rawGit(context.repo,['diff','--no-ext-diff','--no-textconv','--no-renames','--name-only','-z',context.base,context.revision]).split('\0').filter(Boolean);
    const numstat=rawGit(context.repo,['diff','--no-ext-diff','--no-textconv','--no-renames','--numstat','-z',context.base,context.revision]).split('\0').filter(Boolean);
    let changedLines=0;
    for(const entry of numstat) {
      const [added,removed]=entry.split('\t');
      if(added === '-' || removed === '-') changedLines=Math.max(changedLines,context.policy.conditional_triggers.lines_changed_threshold+1);
      else if(!/^\d+$/.test(added) || !/^\d+$/.test(removed)) throw new Error('Unsupported diff.');
      else changedLines+=Number(added)+Number(removed);
    }
    const criticalPaths=files.filter(path=>context.policy.mandatory_paths.some(pattern=>matches(pattern,path)) || /^(?:policies|schemas|profiles|scripts)\//.test(path) || path === 'policy-exceptions.yaml' || /^\.github\/workflows\//.test(path));
    const triggers=[];
    if(criticalPaths.length) triggers.push('mandatory-path');
    if(changedLines > context.policy.conditional_triggers.lines_changed_threshold) triggers.push('changed-line-limit');
    const databasePaths=files.filter(path=>/(^|\/)(migrations?|database|db|prisma|drizzle)(\/|\.)|(^|\/)schema\.(sql|prisma)$|\.sql$/i.test(path));
    if(context.policy.conditional_triggers.modifies_database_schema && databasePaths.length) triggers.push('database-schema');
    let coverageComparison='not-applicable: committed workload unchanged';
    if(context.policy.conditional_triggers.decrease_in_test_coverage && files.some(path=>path === context.contractRelative || !context.workload || path.startsWith(context.workload+'/'))) {
      if(!options['--coverage-evidence']) throw new Error('Coverage comparison required.');
      const coverage=evaluateCoverage({...options,'--evidence':options['--coverage-evidence']});
      if(!('metrics' in coverage) || !coverage.metrics) throw new Error('Coverage evidence invalid.');
      const decreased=/** @type {const} */(['lines','branches']).some(dimension=>{
        const current=coverage.metrics.global[dimension], baseline=coverage.metrics.baseline[dimension];
        return current.percentage !== null && baseline.percentage !== null && current.covered*baseline.total < baseline.covered*current.total;
      });
      coverageComparison=decreased ? 'decreased' : 'no decrease';
      if(decreased) triggers.push('coverage-decrease');
    }
    const requiredApprovals=triggers.length ? context.policy.approvals_required.critical_paths : context.policy.approvals_required.default;
    const agents=new Set((context.policy.agent_accounts ?? []).map(login=>login.toLowerCase()));
    const authorizedHumans=context.policy.human_approvers ? new Set(context.policy.human_approvers.map(login=>login.toLowerCase())) : undefined;
    const exceptionOwners=new Set();
    for(const filename of ['policy-exceptions.yaml','policies/security-dummy-approvals.json']) {
      if(!files.includes(filename)) continue;
      const exists=rawGit(context.repo,['ls-tree',context.revision,'--',filename]);
      if(!exists) continue; // A deletion grants no new exception.
      const value=parse(rawGit(context.repo,['show',`${context.revision}:${filename}`]));
      const entries=filename === 'policy-exceptions.yaml' ? /** @type {{exceptions:Array<{owner:string}>}} */(document('policy-overrides',JSON.stringify(value))).exceptions : value.approvals;
      if(!Array.isArray(entries)) throw new Error('Malformed exception ledger.');
      for(const entry of entries) {
        if(typeof entry.owner !== 'string' || !entry.owner.trim()) throw new Error('Exception lacks owner.');
        exceptionOwners.add(entry.owner.trim().toLowerCase());
      }
    }
    /** @type {Map<string,Review>} */ const latest=new Map();
    for(const review of [...evidence.reviews].sort((a,b)=>Date.parse(a.submitted_at)-Date.parse(b.submitted_at) || a.id-b.id)) {
      if(!Number.isFinite(Date.parse(review.submitted_at)) || Date.parse(review.submitted_at) > Date.now()) throw new Error('Invalid review time.');
      // Comments do not erase approvals or requests for changes. Dismissals do erase their prior approval.
      if(review.state !== 'COMMENTED') latest.set(review.login.toLowerCase(),review);
    }
    const human=/** @param {Review} review */(review)=>review.type === 'User' && !/\[bot\]$/i.test(review.login) && (!authorizedHumans || authorizedHumans.has(review.login.toLowerCase())) && !agents.has(review.login.toLowerCase()) && !exceptionOwners.has(review.login.toLowerCase()) && review.login.toLowerCase() !== evidence.author.toLowerCase() && ['write','maintain','admin'].includes(review.permission);
    const approvals=[...latest.values()].filter(review=>human(review) && review.state === 'APPROVED' && review.commit_id === context.revision);
    const changesRequested=[...latest.values()].filter(review=>human(review) && review.state === 'CHANGES_REQUESTED');
    const passed=approvals.length >= requiredApprovals && !changesRequested.length;
    return {operation:'human-review',outcome:passed ? 'passed' : 'blocked',revision:context.revision,baseRevision:context.base,trustedRevision:context.trusted,policyDigest:context.policyDigest,contractDigest:context.contractDigest,evidenceDigest:digest(JSON.stringify(evidence)),repository:evidence.repository,pullRequest:evidence.pull_request,changedLines,criticalPaths,databasePaths,triggers,coverageComparison,requiredApprovals,approvals:approvals.map(({id,login,commit_id,submitted_at})=>({id,login,revision:commit_id,submittedAt:submitted_at})),changesRequested:changesRequested.map(({id,login})=>({id,login})),results:[{capability:'human-review',required:true,status:passed ? 'passed' : 'failed',reason:`${approvals.length}/${requiredApprovals} current independent human approvals; ${changesRequested.length} outstanding requests for changes. Agents cannot grant policy exceptions.`}]};
  } catch {return reviewError();}
}
