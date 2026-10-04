import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {join,delimiter,isAbsolute,relative,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
import {createHash} from 'node:crypto';
import {proposeChange} from './agent-runner.mjs';
/** @param {string} value */
const hash=value=>createHash('sha256').update(value).digest('hex');
/** Preserve JSON tokens, including precision and duplicate keys; change whitespace only. @param {string} source */
function formatJson(source) {
 JSON.parse(source);
 const tokens=source.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
 if(!tokens) throw new Error('json');
 let output='',depth=0;
 const line=()=>{output+='\n'+'  '.repeat(depth);};
 for(let i=0;i<tokens.length;i++) {
  const token=tokens[i],next=tokens[i+1],previous=tokens[i-1];
  if(token==='{' || token==='[') {output+=token;if(next!=='}' && next!==']') {if(++depth>100) throw new Error('depth');line();}}
  else if(token==='}' || token===']') {if(previous!=='{' && previous!=='[') {depth--;line();}output+=token;}
  else if(token===',') {output+=token;line();}
  else if(token===':') output+=': ';
  else output+=token;
 }
 return output+'\n';
}
/** @param {string} repo @param {string[]} args */
function git(repo,args) {
 const program=(process.env.PATH??'').split(delimiter).filter(isAbsolute).map(p=>join(p,process.platform==='win32'?'git.exe':'git')).find(p=>existsSync(p) && (()=>{const r=relative(realpathSync(repo),realpathSync(p));return isAbsolute(r)||r==='..'||r.startsWith('..'+sep);})());
 if(!program) throw new Error('git');const r=spawnSync(realpathSync(program),args,{cwd:repo,encoding:'utf8',timeout:10000,maxBuffer:1048576,windowsHide:true});if(r.status!==0) throw new Error('git');return r.stdout;
}
/** @param {string} path @param {string|undefined} token @param {string} method @param {unknown} body */
async function api(path,token,method='GET',body=undefined) {
 if(!token) throw new Error('credential');const response=await fetch('https://api.github.com/'+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(response.status===404 && method==='GET') return null;if(!response.ok) throw new Error('api');const text=await response.text();if(text.length>1048576) throw new Error('size');return /** @type {any} */(JSON.parse(text));
}
/** GitHub event and host environment are trusted transport; repository/comment/payload text is data. @param {Record<string,string>} options */
export async function remediate(options) {
 let temporary='';let reason='Invalid request or unavailable authoritative evidence; runner and publication were not authorized.';
 /** @type {Record<string,unknown>} */ let evidence={};
 try {
  const repo=options['--repository'],trusted=options['--trusted-revision'],trustedRepo=options['--trusted-repo']??'.',sourceRepo=options['--repository-path'];
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo??'') || !/^[a-f0-9]{40}$/.test(trusted??'') || !['authorize','prepare','publish'].includes(options['--mode'])) throw new Error('options');
  const raw=readFileSync(process.env.GITHUB_EVENT_PATH??'','utf8');if(Buffer.byteLength(raw)>65536) throw new Error('input');const event=JSON.parse(raw),kind=process.env.GITHUB_EVENT_NAME,actor=process.env.GITHUB_ACTOR;
  if(!/^[A-Za-z0-9_-]{1,39}$/.test(actor??'') || event.sender?.login!==actor || event.sender?.type!=='User' || event.repository?.full_name!==repo || process.env.GITHUB_REF!=='refs/heads/main') throw new Error('origin');
  const policySource=git(trustedRepo,['show',`${trusted}:policies/agents.yaml`]),policy=parse(policySource)?.agents?.remediation;
  if(!policy || !Array.isArray(policy.allowed_callers) || !policy.allowed_callers.includes(actor) || !/^[A-Za-z0-9_-]+\[bot\]$/.test(policy.app_actor??'')) throw new Error('policy');
  const prefix=`repos/${repo}`,readToken=process.env.FACTORY_GITHUB_TOKEN;
  const permission=await api(`${prefix}/collaborators/${actor}/permission`,readToken);
  if(!permission || permission.user?.login!==actor || permission.user?.type!=='User' || !['admin','maintain','write'].includes(permission.permission)) throw new Error('permission');
  const authority=await api(`${prefix}/git/ref/heads/main`,readToken);if(authority?.object?.sha!==trusted) throw new Error('stale authority');
  let request,id;
  if(kind==='workflow_dispatch' || kind==='repository_dispatch') {
   if(kind==='repository_dispatch' && event.action!=='factory-remediate') throw new Error('dispatch');
   request=kind==='workflow_dispatch'?event.inputs:event.client_payload;id=process.env.GITHUB_RUN_ID;
  } else if(kind==='issue_comment') {
   if(event.action!=='created' || !Number.isSafeInteger(event.comment?.id) || !event.issue?.pull_request) throw new Error('comment');
   const comment=await api(`${prefix}/issues/comments/${event.comment.id}`,readToken);
   if(!comment || comment.user?.login!==actor || comment.user?.type!=='User' || comment.body!==event.comment.body) throw new Error('changed comment');
   const match=/^\/factory format-json (feat\/[A-Za-z0-9_/-]{1,100}) ([a-f0-9]{40}) ([A-Za-z0-9_./-]{1,200})$/.exec(comment.body);
   if(!match) throw new Error('comment syntax');request={operation:'format-json',source_branch:match[1],source_sha:match[2],path:match[3]};id=String(event.comment.id);
   const pull=await api(`${prefix}/pulls/${event.issue.number}`,readToken);
   if(!pull || pull.state!=='open' || pull.head?.repo?.full_name!==repo || pull.head.ref!==request.source_branch || pull.head.sha!==request.source_sha || pull.base?.ref!=='main') throw new Error('fork or stale PR');
  } else throw new Error('event');
  if(!/^[0-9]{1,20}$/.test(id??'') || !request || Object.keys(request).sort().join(',')!=='operation,path,source_branch,source_sha' || Object.values(request).some(v=>typeof v!=='string') || request.operation!=='format-json' || !/^feat\/[A-Za-z0-9_/-]{1,100}$/.test(request.source_branch) || request.source_branch.split('/').some((/** @type {string} */ p)=>!p || p==='.' || p==='..') || !/^[a-f0-9]{40}$/.test(request.source_sha) || !/^(src|tests|docs)\/[A-Za-z0-9_./-]{1,190}\.json$/.test(request.path)) throw new Error('request');
  const source=await api(`${prefix}/git/ref/heads/${request.source_branch}`,readToken);
  if(source?.object?.sha!==request.source_sha) throw new Error('stale source');
  if(options['--mode']==='authorize') return result('passed','Caller and explicit source authorized; runner not executed.',{actor,repository:repo,trustedRevision:trusted,sourceBranch:request.source_branch,revision:request.source_sha});
  if(git(sourceRepo,['rev-parse','HEAD']).trim()!==request.source_sha) throw new Error('checkout');
  if(!/^100644 blob [a-f0-9]{40}\t/.test(git(sourceRepo,['ls-tree',request.source_sha,'--',request.path]))) throw new Error('file mode');
  const content=git(sourceRepo,['show',`${request.source_sha}:${request.path}`]);if(Buffer.byteLength(content)>65536 || content.includes('\u0000') || content.includes('\ufffd')) throw new Error('content');
  const formatted=formatJson(content);if(formatted===content) {reason='No supported JSON formatting fix exists; no branch or PR created.';throw new Error('no-op');}
  const scope='remediation-'+hash(`${repo}:${kind}:${id}`).slice(0,52),branch='feat/factory-remediation-'+hash(`${repo}:${kind}:${id}`).slice(0,32),requestDigest=hash(JSON.stringify(request));
  evidence={actor,event:kind,eventId:id,repository:repo,revision:request.source_sha,trustedRevision:trusted,policyDigest:hash(policySource),requestDigest,branch,validation:'JSON parse and deterministic formatting at the exact named revision; full PR gates required before merge'};
  // Every replay reauthorizes caller, policy, and exact source revision before looking up durable remote evidence.
  const prior=await api(`${prefix}/git/ref/heads/${branch}`,readToken);
  if(prior) {
   const signature=await api(`${prefix}/commits/${prior.object.sha}`,readToken);
   if(signature?.commit?.verification?.verified!==true) throw new Error('unverified replay');
   const commit=await api(`${prefix}/git/commits/${prior.object.sha}`,readToken);
   if(commit?.message!==`Factory format-json ${requestDigest}` || commit.parents?.length!==1 || commit.parents[0].sha!==request.source_sha) throw new Error('dedup collision');
   const changed=await api(`${prefix}/compare/${request.source_sha}...${prior.object.sha}`,readToken);
   if(changed?.files?.length!==1 || changed.files[0].filename!==request.path || changed.commits?.length!==1) throw new Error('changed branch');
   const file=await api(`${prefix}/contents/${request.path}?ref=${prior.object.sha}`,readToken);
   if(file?.type!=='file' || Buffer.from(file.content??'','base64').toString('utf8')!==formatted) throw new Error('changed content');
   const prs=await api(`${prefix}/pulls?state=all&head=${repo.split('/')[0]}:${branch}&base=main&per_page=100`,readToken);
   if(!Array.isArray(prs) || prs.length!==1 || prs[0].head?.sha!==prior.object.sha || prs[0].user?.login!==policy.app_actor) throw new Error('publication interrupted; operator recovery required');
   return result('passed','Existing exact fix PR reused; no new runner spending or writes.',{...evidence,replay:true,pullRequest:prs[0].html_url,fixRevision:prior.object.sha});
  }
  if(Number(process.env.GITHUB_RUN_ATTEMPT??'1')!==1) {reason='Hosted rerun has no durable published scope; operator recovery required before another runner reservation.';throw new Error('rerun');}
  // Fixed data-only adapter, not arbitrary issue instructions or vendor-generated commands.
  temporary=mkdtempSync(join(tmpdir(),'factory-remediation-'));const proposal=join(temporary,'proposal.json');writeFileSync(proposal,JSON.stringify({version:'1.0',adapter:'fixture',actions:[{tool:'write_file',path:request.path,content:formatted}]}),{mode:0o600});
  const runner=await proposeChange({...options,'--proposal':proposal,'--scope-id':scope,'--actor':actor??''});evidence.runner=runner;
  if(runner.outcome!=='passed' || !('workspace' in runner)) {reason='Bounded runner denied the proposed fix.';throw new Error('runner');}
  if(readFileSync(join(/** @type {string} */(runner.workspace),request.path),'utf8')!==formatted) throw new Error('validation');
  if(options['--mode']==='prepare') return result('passed','Authorized bounded fix prepared; no remote writes or PR created.',evidence);
  // Writer and PR installation credentials are separate from authorization reads. No workload command gets either credential.
  reason='Publication failed or was interrupted; no merge attempted. Preserve the event scope and inspect its branch before recovery.';
  const pushToken=process.env.FACTORY_PUSH_TOKEN,prToken=process.env.FACTORY_PR_TOKEN;if(!pushToken || !prToken) {reason='Publishing requires separate Contents-write and dedicated App PR-write credentials.';throw new Error('credential');}
  const installation=await api('installation/repositories?per_page=100',prToken);
  if(!installation || !Array.isArray(installation.repositories) || !installation.repositories.some((/** @type {{full_name:string}} */ r)=>r.full_name===repo)) throw new Error('installation');
  const current=await api(`${prefix}/git/ref/heads/${request.source_branch}`,readToken),currentAuthority=await api(`${prefix}/git/ref/heads/main`,readToken);
  if(current?.object?.sha!==request.source_sha || currentAuthority?.object?.sha!==trusted) {reason='Source or authority changed before publishing; request a new exact revision.';throw new Error('stale');}
  const original=await api(`${prefix}/contents/${request.path}?ref=${request.source_sha}`,readToken);
  if(original?.type!=='file' || Buffer.from(original.content??'','base64').toString('utf8')!==content) throw new Error('source content');
  await api(`${prefix}/git/refs`,pushToken,'POST',{ref:'refs/heads/'+branch,sha:request.source_sha});
  const updated=await api('graphql',pushToken,'POST',{query:'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid signature{isValid}}}}',variables:{input:{branch:{repositoryNameWithOwner:repo,branchName:branch},expectedHeadOid:request.source_sha,message:{headline:`Factory format-json ${requestDigest}`},fileChanges:{additions:[{path:request.path,contents:Buffer.from(formatted).toString('base64')}]}}}});
  const signed=updated?.data?.createCommitOnBranch?.commit,commit={sha:signed?.oid};
  if(updated?.errors || !/^[a-f0-9]{40}$/.test(commit.sha??'') || signed.signature?.isValid!==true) {reason='Published commit signature is not verified; no PR opened. Operator recovery required.';throw new Error('commit');}
  const verified=await api(`${prefix}/compare/${request.source_sha}...${commit.sha}`,readToken);
  if(verified?.files?.length!==1 || verified.files[0].filename!==request.path || verified.files[0].status!=='modified' || verified.commits?.length!==1 || verified.commits[0].sha!==commit.sha) throw new Error('exact validation');
  const finalFile=await api(`${prefix}/contents/${request.path}?ref=${commit.sha}`,readToken);
  if(finalFile?.type!=='file' || Buffer.from(finalFile.content??'','base64').toString('utf8')!==formatted) throw new Error('exact content');
  const finalSource=await api(`${prefix}/git/ref/heads/${request.source_branch}`,readToken);if(finalSource?.object?.sha!==request.source_sha) throw new Error('source race');
  const pr=await api(`${prefix}/pulls`,prToken,'POST',{title:'Factory: format JSON data',head:branch,base:'main',maintainer_can_modify:false,body:`Bounded format-json remediation.\n\nSource: ${request.source_sha}\nTrusted policy: ${trusted}\nRequest digest: ${requestDigest}\nFix commit: ${commit.sha}\n\nThe source branch changes are included. Full exact-head PR checks and independent human approval are required. No auto-merge is authorized.`});
  if(pr.user?.login!==policy.app_actor || pr.head?.sha!==commit.sha || !/^https:\/\/github.com\//.test(pr.html_url??'')) {reason='Unexpected PR identity or revision; operator investigation required.';throw new Error('identity');}
  return result('passed','Genuine bounded fix committed and proposed by the dedicated App; no merge attempted.',{...evidence,fixRevision:commit.sha,pullRequest:pr.html_url,replay:false});
 } catch {return result('blocked',reason,evidence);} finally {if(temporary) rmSync(temporary,{recursive:true,force:true});}
}
/** @param {string} outcome @param {string} reason @param {Record<string,unknown>} evidence */
function result(outcome,reason,evidence) {return {operation:'remediation',outcome,...evidence,results:[{capability:'agent-remediation',required:true,status:outcome==='passed'?'passed':'error',reason}]};}
