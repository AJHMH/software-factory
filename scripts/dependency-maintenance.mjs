import {resolve} from 'node:path';
import {parse} from 'yaml';
import {rawGit} from './coverage-evaluation.mjs';
const botId=49699333;
const sections=['dependencies','devDependencies','optionalDependencies','peerDependencies'];
/** @typedef {Record<string, any>} Json */
/** @param {string} reason @returns {never} */
function deny(reason) {throw new Error(reason);}
/** @param {unknown} value @returns {value is Json} */
function object(value) {return value!==null && typeof value==='object' && !Array.isArray(value);}
/** @param {unknown} value @returns {string} */
function canonical(value) {
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if(object(value)) return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
/** @param {string} path @param {string} method @param {unknown} body @returns {Promise<Json>} */
async function api(path,method='GET',body=undefined) {
 if(!process.env.FACTORY_GITHUB_TOKEN) deny('GitHub authentication is unavailable.');
 const response=await fetch(`https://api.github.com/${path}`,{method,headers:{Authorization:`Bearer ${process.env.FACTORY_GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok) deny('GitHub rejected the request; hosted protections are never bypassed.');
 const text=await response.text();if(text.length>4*1024*1024) deny('GitHub response exceeds the supported limit.');return JSON.parse(text);
}
/** @param {string} path @param {string | undefined} envelope @returns {Promise<Json[]>} */
async function list(path,envelope=undefined) {
 const entries=[];
 for(let page=1;page<=10;page++) {
  const result=await api(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`),values=envelope?result[envelope]:result;
  if(!Array.isArray(values)) deny('GitHub returned an incomplete list.');entries.push(...values);
  if(values.length<100) {if(envelope && result.total_count!==entries.length) deny('GitHub list was truncated.');return entries;}
 }
 return deny('GitHub pagination exceeds the supported limit.');
}
/** @param {string} repository @param {string} path @param {string} sha @returns {Promise<Json>} */
async function jsonFile(repository,path,sha) {
 const response=await api(`repos/${repository}/contents/${path}?ref=${sha}`);
 if(response.type!=='file' || response.encoding!=='base64' || typeof response.content!=='string') deny('A regular committed package file is required.');
 const text=Buffer.from(response.content,'base64').toString('utf8');if(text.includes('\ufffd')) deny('Package data must be valid UTF-8.');
 const value=JSON.parse(text);if(!object(value)) deny('Malformed package data.');return value;
}
/** @param {Record<string,string>} options */
function context(options) {
 const repository=options['--repository'],sha=options['--trusted-revision'],repo=resolve(options['--trusted-repo']??'.');
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository??'') || !/^[a-f0-9]{40}$/.test(sha??'') || !['evaluate','merge'].includes(options['--mode']??'')) deny('Repository, trusted commit, and evaluate/merge mode are required.');
 if(rawGit(repo,['cat-file','-t',sha]).trim()!=='commit') deny('Trusted policy must be a commit.');
 const dependencies=parse(rawGit(repo,['show',`${sha}:policies/dependencies.yaml`])).dependencies;
 const human=parse(rawGit(repo,['show',`${sha}:policies/human-review.yaml`])).human_review;
 const protection=parse(rawGit(repo,['show',`${sha}:policies/governance.yaml`])).governance.repository_protection;
 if(!object(dependencies) || !object(dependencies.strategy) || !Array.isArray(dependencies.exemptions?.require_human_always) || !dependencies.exemptions.require_human_always.every((/** @type {unknown} */ name)=>typeof name==='string') || !Array.isArray(human.human_approvers) || !human.human_approvers.length || !Number.isInteger(human.approvals_required?.default) || human.approvals_required.default<1 || !Number.isInteger(human.approvals_required.critical_paths) || human.approvals_required.critical_paths<human.approvals_required.default || !Number.isInteger(protection.minimum_approvals) || protection.minimum_approvals<1 || !Array.isArray(protection.required_checks) || !protection.required_checks.length || !protection.required_checks.every((/** @type {Json} */ check)=>typeof check.context==='string' && Number.isInteger(check.integration_id) && check.integration_id>0)) deny('Trusted dependency, human, or check policy is malformed.');
 for(const kind of ['patch','minor','major']) {const rule=dependencies.strategy[kind];if(!object(rule) || !['auto_merge','propose_pr'].includes(rule.action) || rule.require_tests_pass!==true || typeof rule.human_review_required!=='boolean') deny('Unsupported dependency strategy.');}
 if(!protection.required_checks.some((/** @type {Json} */ check)=>check.context==='Enforce Factory secret and dependency policy')) deny('Exact-head security enforcement is required.');
 if(!['info','low','medium','high','critical'].includes(dependencies.vulnerability_threshold?.max_severity_allowed)) deny('Invalid vulnerability threshold.');
 return {repository,sha,dependencies,human,protection};
}
/** @param {unknown} value */
function version(value) {
 if(typeof value!=='string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) deny('Prerelease or unsupported version requires manual review.');
 const parts=value.split('.').map(Number);if(parts.some(part=>!Number.isSafeInteger(part))) deny('Invalid version.');return parts;
}
/** @param {string} before @param {string} after */
function updateKind(before,after) {
 const a=version(before),b=version(after),index=b.findIndex((value,index)=>value!==a[index]);
 if(index<0 || b[index]<a[index]) deny('Dependency downgrades and unchanged versions are not automatic updates.');
 return index===0?'major':index===1?'minor':'patch';
}
/** @param {Json} manifest @param {Json} lock */
function validatePackage(manifest,lock) {
 if(lock.lockfileVersion!==3 || !object(lock.packages) || !object(lock.packages['']) || manifest.workspaces || lock.packages[''].workspaces) deny('Only npm lockfile v3 without workspaces is supported.');
 for(const field of sections) {
  const dependencies=manifest[field]??{};
  if(!object(dependencies) || canonical(dependencies)!==canonical(lock.packages[''][field]??{})) deny('Manifest and lockfile dependency declarations disagree.');
  for(const [name,range] of Object.entries(dependencies)) {
   if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || typeof range!=='string' || !/^[~^]?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(range)) deny('Unsupported dependency declaration.');
   if(!object(lock.packages[`node_modules/${name}`])) deny('Declared dependency is absent from the lockfile.');
  }
 }
 for(const [path,entry] of Object.entries(lock.packages)) {
  if(path==='') continue;
  if(!/^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+\/)*node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(path) || !object(entry) || entry.link || typeof entry.resolved!=='string' || typeof entry.integrity!=='string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)) deny('Unsupported lockfile package source or integrity.');
  const source=new URL(entry.resolved);if(source.protocol!=='https:' || source.hostname!=='registry.npmjs.org' || source.username || source.password || source.port || source.search || source.hash) deny('Only npm registry tarballs are eligible.');version(entry.version);
 }
}
/** @param {ReturnType<typeof context>} ctx @param {Json} pr */
async function changes(ctx,pr) {
 const files=await list(`repos/${ctx.repository}/pulls/${pr.number}/files`);
 if(!files.length || files.some(file=>file.status!=='modified' || !/^(?:examples\/reference-workload\/)?package(?:-lock)?\.json$/.test(file.filename))) deny('Sensitive or unrelated file changes require a manual merge.');
 const directories=[...new Set(files.map(file=>file.filename.startsWith('examples/')?'examples/reference-workload/':''))],updates=[],metadata=[];
 for(const prefix of directories) {
  const [before,after,lockBefore,lockAfter]=await Promise.all([jsonFile(ctx.repository,prefix+'package.json',pr.base.sha),jsonFile(ctx.repository,prefix+'package.json',pr.head.sha),jsonFile(ctx.repository,prefix+'package-lock.json',pr.base.sha),jsonFile(ctx.repository,prefix+'package-lock.json',pr.head.sha)]);
  validatePackage(before,lockBefore);validatePackage(after,lockAfter);
  const stripped=(/** @type {Json} */ manifest)=>Object.fromEntries(Object.entries(manifest).filter(([key])=>!sections.includes(key)));
  if(canonical(stripped(before))!==canonical(stripped(after))) deny('Package scripts and unrelated manifest metadata cannot change automatically.');
  for(const field of sections) {
   const a=before[field]??{},b=after[field]??{};
   if(canonical(Object.keys(a).sort())!==canonical(Object.keys(b).sort())) deny('Adding or removing direct dependencies requires manual review.');
   for(const name of Object.keys(a)) if(a[name]!==b[name]) {
    if(a[name].replace(/[0-9]/g,'')!==b[name].replace(/[0-9]/g,'')) deny('Changing dependency range semantics requires manual review.');
    if(lockBefore.packages[`node_modules/${name}`].version===lockAfter.packages[`node_modules/${name}`].version) deny('A direct dependency range changed without an actual resolved package update.');
    updates.push({name,before:a[name].replace(/^[~^]/,''),after:b[name].replace(/^[~^]/,''),kind:updateKind(a[name].replace(/^[~^]/,''),b[name].replace(/^[~^]/,'')),path:prefix+'package.json'});
   }
  }
  const stripLock=(/** @type {Json} */ lock)=>Object.fromEntries(Object.entries(lock).filter(([key])=>key!=='packages'));
  const stripRoot=(/** @type {Json} */ lock)=>Object.fromEntries(Object.entries(lock.packages['']).filter(([key])=>!sections.includes(key)));
  if(canonical(stripLock(lockBefore))!==canonical(stripLock(lockAfter)) || canonical(stripRoot(lockBefore))!==canonical(stripRoot(lockAfter))) deny('Unrelated lockfile metadata changed.');
  const a=lockBefore.packages,b=lockAfter.packages;
  if(canonical(Object.keys(a).sort())!==canonical(Object.keys(b).sort())) deny('New or removed transitive packages require manual review.');
  for(const path of Object.keys(a).filter(path=>path!=='')) {
   if(canonical(a[path])===canonical(b[path])) continue;
   if(a[path].version===b[path].version) deny('A package changed without a version update.');
   const name=path.slice(path.lastIndexOf('node_modules/')+13);
   updates.push({name,before:a[path].version,after:b[path].version,kind:updateKind(a[path].version,b[path].version),path:prefix+'package-lock.json'});
   metadata.push({name,version:b[path].version,resolved:b[path].resolved,integrity:b[path].integrity});
  }
 }
 if(!updates.length) deny('No actual version updates were found.');
 for(const item of metadata) {
  const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(item.name)}`,{headers:{Accept:'application/vnd.npm.install-v1+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok) deny('npm registry metadata is unavailable.');
  const text=await response.text();if(text.length>16*1024*1024) deny('npm registry metadata exceeds the supported limit.');
  const packageMetadata=JSON.parse(text),release=packageMetadata.versions?.[item.version];
  if(packageMetadata.name!==item.name || release?.name!==item.name || release.version!==item.version || release.dist?.tarball!==item.resolved || release.dist?.integrity!==item.integrity) deny(`Registry metadata does not verify ${item.name}@${item.version}.`);
 }
 for(const update of updates) {
  const rule=ctx.dependencies.strategy[update.kind];
  if(update.kind==='major' || rule.action!=='auto_merge' || rule.human_review_required || ctx.dependencies.exemptions.require_human_always.includes(update.name)) deny(`Manual merge required for ${update.name} (${update.kind} or exempt dependency).`);
 }
 return updates;
}
/** @param {ReturnType<typeof context>} ctx @param {Json} pr */
async function evidence(ctx,pr) {
 const endpoint=`repos/${ctx.repository}/pulls/${pr.number}`,commits=await list(endpoint+'/commits');
 if(!commits.length || commits.at(-1)?.sha!==pr.head.sha || commits.some(commit=>commit.author?.id!==botId || commit.author?.login!=='dependabot[bot]' || commit.author?.type!=='Bot' || commit.commit?.verification?.verified!==true || commit.committer?.id!==19864447)) deny('All proposal commits must be verified Dependabot commits signed by GitHub.');
 const reviews=await list(endpoint+'/reviews'),latest=new Map();
 for(const review of reviews) {
  if(review.state==='PENDING' || review.state==='COMMENTED') continue;
  if(!Number.isSafeInteger(review.id) || !review.user || typeof review.user.login!=='string') deny('Malformed review history.');
  const login=review.user.login.toLowerCase(),old=latest.get(login);if(!old || old.id<review.id) latest.set(login,review);
 }
 let approvals=0;
 for(const [login,review] of latest) {
  if(review.state==='CHANGES_REQUESTED') deny('An outstanding review requests changes.');
  if(review.state!=='APPROVED' || review.commit_id!==pr.head.sha || review.user.type!=='User' || !ctx.human.human_approvers.includes(login) || ctx.human.agent_accounts?.includes(login)) continue;
  if(!/^[a-z0-9_-]+$/.test(login)) deny('Invalid reviewer identity.');
  const permission=await api(`repos/${ctx.repository}/collaborators/${login}/permission`);if(['admin','maintain','write'].includes(permission.permission)) approvals++;
 }
 if(approvals<Math.max(ctx.protection.minimum_approvals,ctx.human.approvals_required.default,ctx.human.approvals_required.critical_paths)) deny('Current independent human approvals are missing.');
 const runs=await list(`repos/${ctx.repository}/commits/${pr.head.sha}/check-runs?filter=all`,'check_runs');
 for(const required of ctx.protection.required_checks) {
  const matches=runs.filter(run=>run.name===required.context && run.app?.id===required.integration_id && run.head_sha===pr.head.sha);
  if(!matches.length || matches.some(run=>run.status!=='completed' || run.conclusion!=='success')) deny(`Required exact-head check has not passed: ${required.context}.`);
 }
 if(runs.some(run=>run.head_sha!==pr.head.sha || run.status!=='completed' || !['success','neutral','skipped'].includes(run.conclusion))) deny('A head check is pending or failed.');
 const status=await api(`repos/${ctx.repository}/commits/${pr.head.sha}/status?per_page=100`);
 if(!Array.isArray(status.statuses) || status.total_count!==status.statuses.length || status.statuses.some((/** @type {Json} */ entry)=>entry.state!=='success')) deny('Commit status evidence is incomplete or failed.');
 return {reviews,runs,status};
}
/** @param {ReturnType<typeof context>} ctx @param {Json} pr */
async function inspect(ctx,pr) {
 if(pr.state!=='open' || pr.draft || pr.user?.id!==botId || pr.user.login!=='dependabot[bot]' || pr.user.type!=='Bot' || pr.head?.repo?.full_name?.toLowerCase()!==ctx.repository.toLowerCase() || pr.base?.repo?.full_name?.toLowerCase()!==ctx.repository.toLowerCase() || pr.base.ref!=='main' || !/^dependabot\//.test(pr.head.ref) || !/^[a-f0-9]{40}$/.test(pr.head.sha) || pr.base.sha!==ctx.sha || pr.mergeable!==true || pr.mergeable_state!=='clean') deny('Proposal identity, current base, or merge readiness is invalid.');
 const base=await api(`repos/${ctx.repository}/branches/main`);if(base.commit?.sha!==ctx.sha) deny('Trusted policy is no longer the current main revision.');
 return {updates:await changes(ctx,pr),evidence:await evidence(ctx,pr)};
}
/** @param {Record<string,string>} options */
export async function maintainDependencies(options) {
 /** @type {Json[]} */ const proposals=[];
 try {
  const ctx=context(options),number=options['--pull-request'];if(number && !/^[1-9][0-9]{0,8}$/.test(number)) deny('Invalid pull request number.');
  const prs=number?[await api(`repos/${ctx.repository}/pulls/${number}`)]:(await list(`repos/${ctx.repository}/pulls?state=open&base=main`)).filter(pr=>pr.user?.id===botId);
  for(const pr of prs) {
   try {
    const first=await inspect(ctx,pr);let merged=false;
    if(options['--mode']==='merge') {
     const current=await api(`repos/${ctx.repository}/pulls/${pr.number}`);if(current.head.sha!==pr.head.sha || current.base.sha!==pr.base.sha) deny('Proposal became stale during inspection.');
     const second=await inspect(ctx,current);if(canonical(first)!==canonical(second)) deny('Approval or validation evidence changed during inspection.');
     const final=await api(`repos/${ctx.repository}/pulls/${pr.number}`);if(final.head.sha!==pr.head.sha || final.base.sha!==ctx.sha || final.state!=='open' || final.draft || final.mergeable_state!=='clean') deny('Proposal changed before merging.');
     const result=await api(`repos/${ctx.repository}/pulls/${pr.number}/merge`,'PUT',{sha:pr.head.sha,merge_method:'squash'});
     if(result.merged!==true || !/^[a-f0-9]{40}$/.test(result.sha??'')) deny('GitHub did not confirm the merge.');merged=true;
    }
    proposals.push({pullRequest:pr.number,revision:pr.head.sha,outcome:'passed',merged,updates:first.updates});
   } catch(error) {proposals.push({pullRequest:pr.number,revision:pr.head?.sha,outcome:'blocked',merged:false,reason:error instanceof Error?error.message:'Dependency proposal is unavailable.'});}
  }
  const blocked=proposals.some(pr=>pr.outcome==='blocked');return {operation:'dependencies',outcome:blocked?'blocked':'passed',proposals,results:[{capability:'dependency-automation',required:true,status:blocked?'error':'passed',reason:blocked?'One or more proposals require attention; no denied proposal was merged.':prs.length?'Exact-head proposals were inspected against current approvals, checks, and hosted protections.':'No open Dependabot proposals were found; no merge was attempted.'}]};
 } catch(error) {return {operation:'dependencies',outcome:'blocked',proposals,results:[{capability:'dependency-automation',required:true,status:'error',reason:error instanceof Error?error.message:'Dependency evidence is unavailable.'}]};}
}
