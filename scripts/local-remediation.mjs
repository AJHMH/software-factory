import {readFileSync,writeFileSync,mkdtempSync,rmSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,join,relative,isAbsolute,sep,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPrivateKey,sign} from 'node:crypto';
import {remediate} from './remediation.mjs';

/** @param {string} path @param {string} token @param {unknown} body */
async function github(path,token,body=undefined) {
 const response=await fetch('https://api.github.com/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok) throw new Error('GitHub authentication');const text=await response.text();if(text.length>1048576) throw new Error('response size');return /** @type {any} */(JSON.parse(text));
}
/** @param {string} filename @param {string[]} repositories */
function externalKey(filename,repositories) {
 const path=resolve(filename);let ancestor=path;
 while(true) {if(lstatSync(ancestor).isSymbolicLink()) throw new Error('linked key');const parent=dirname(ancestor);if(parent===ancestor) break;ancestor=parent;}
 const canonical=realpathSync(path),stat=lstatSync(canonical);if(!stat.isFile() || stat.nlink!==1 || stat.size>16384) throw new Error('key');
 for(const repository of repositories) {const within=relative(realpathSync(repository),canonical);if(!within || (!isAbsolute(within) && within!=='..' && !within.startsWith('..'+sep))) throw new Error('key inside repository');}
 return canonical;
}
/** Local operator approval is distinct from the subsequent independent GitHub PR review. @param {Record<string,string>} options */
export async function localRemediate(options) {
 const names=['GITHUB_EVENT_NAME','GITHUB_EVENT_PATH','GITHUB_ACTOR','GITHUB_REF','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','FACTORY_PUSH_TOKEN','FACTORY_PR_TOKEN'];
 const prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));let temporary='',installationToken='';
 let reason='Local request or authenticated human identity is invalid; no publication started.';
 try {
  if(!['prepare','publish'].includes(options['--mode']) || !/^[0-9]{1,20}$/.test(options['--request-id']??'')) throw new Error('request');
  const humanToken=process.env.FACTORY_GITHUB_TOKEN;if(!humanToken) throw new Error('human authentication');
  const human=await github('user',humanToken);if(human.type!=='User' || !/^[A-Za-z0-9_-]{1,39}$/.test(human.login??'')) throw new Error('human');
  temporary=mkdtempSync(join(tmpdir(),'factory-local-request-'));const eventFile=join(temporary,'event.json');
  writeFileSync(eventFile,JSON.stringify({sender:{login:human.login,type:'User'},repository:{full_name:options['--repository']},inputs:{operation:'format-json',source_branch:options['--source-branch'],source_sha:options['--source-revision'],path:options['--path']}}),{mode:0o600});
  Object.assign(process.env,{GITHUB_EVENT_NAME:'local_manual',GITHUB_EVENT_PATH:eventFile,GITHUB_ACTOR:human.login,GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:options['--request-id'],GITHUB_RUN_ATTEMPT:'1'});
  delete process.env.FACTORY_PUSH_TOKEN;delete process.env.FACTORY_PR_TOKEN;
  const preview=await remediate({...options,'--mode':'prepare'});
  if(preview.outcome!=='passed' || options['--mode']==='prepare') return preview;
  reason='Publication requires explicit --approve true and the exact reviewed --expected-proposal-digest; App key was not loaded.';
  if(options['--approve']!=='true' || !/^[a-f0-9]{64}$/.test(options['--expected-proposal-digest']??'') || !('proposalDigest' in preview) || preview.proposalDigest!==options['--expected-proposal-digest']) throw new Error('approval');
  if('replay' in preview && preview.replay===true) return preview;
  reason='Local App authentication failed; no fix branch or PR created.';
  const keyPath=externalKey(options['--private-key-path'],[options['--repository-path'],options['--trusted-repo']??'.',fileURLToPath(new URL('../',import.meta.url))]);
  const appId=options['--app-id']??'5180250',installationId=options['--installation-id']??'167664341';if(!/^[0-9]{1,20}$/.test(appId) || !/^[0-9]{1,20}$/.test(installationId)) throw new Error('App identity');
  const key=createPrivateKey(readFileSync(keyPath));if(key.asymmetricKeyType!=='rsa') throw new Error('RSA');const now=Math.floor(Date.now()/1000);
  const unsigned=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({iat:now-60,exp:now+540,iss:appId})).toString('base64url');
  const jwt=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url');
  const app=await github('app',jwt);if(String(app.id)!==appId) throw new Error('App');
  const installation=await github(`app/installations/${installationId}/access_tokens`,jwt,{repositories:[options['--repository'].split('/')[1]],permissions:{contents:'read',pull_requests:'write'}});
  if(installation.permissions?.contents!=='read' || installation.permissions?.pull_requests!=='write' || typeof installation.token!=='string') throw new Error('scope');
  installationToken=installation.token;process.env.FACTORY_PR_TOKEN=installationToken;process.env.FACTORY_PUSH_TOKEN=humanToken;
  return await remediate({...options,'--mode':'publish'});
 } catch {return {operation:'local-remediation',outcome:'blocked',results:[{capability:'agent-remediation',required:true,status:'error',reason}]};}
 finally {
  if(installationToken) {try {await fetch('https://api.github.com/installation/token',{method:'DELETE',headers:{Authorization:'Bearer '+installationToken,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});}catch { /* Token expires in one hour if revocation is unavailable. */ }}
  for(const name of names) {if(prior[name]===undefined) delete process.env[name];else process.env[name]=prior[name];}
  if(temporary) rmSync(temporary,{recursive:true,force:true});
 }
}
