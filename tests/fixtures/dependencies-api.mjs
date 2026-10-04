import {readFileSync,writeFileSync} from 'node:fs';
import {parse} from 'yaml';
const filename=process.env.FACTORY_TEST_API;
const state=JSON.parse(readFileSync(filename,'utf8'));
const checks=parse(readFileSync(new URL('../../policies/governance.yaml',import.meta.url),'utf8')).governance.repository_protection.required_checks;
let reads=0;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(String(input)),path=url.pathname;
 if(url.hostname==='registry.npmjs.org') {const name=decodeURIComponent(path.slice(1)),entry=Object.values(state.lockAfter.packages).find(entry=>entry.resolved && entry.version);return Response.json({name:state.metadataMismatch?'impostor':name,versions:{[entry.version]:{name,version:entry.version,dist:{tarball:entry.resolved,integrity:entry.integrity}}}});}
 if(url.hostname!=='api.github.com') throw new Error('Unexpected fixture origin');
 const pr=()=>({number:7,state:'open',draft:false,mergeable:true,mergeable_state:'clean',user:{login:state.author,type:state.authorType,id:state.authorId},head:{sha:state.head,ref:'dependabot/npm_and_yarn/yaml-2.9.1',repo:{full_name:'org/repo'}},base:{sha:state.base,ref:'main',repo:{full_name:'org/repo'}}});
 let body;
 if(path.endsWith('/pulls/7/merge')) {if(state.mergeDenied) return Response.json({message:'Branch protection denied merge'},{status:405});state.merge=JSON.parse(options.body);writeFileSync(filename,JSON.stringify(state));return Response.json({merged:true,sha:'c'.repeat(40)});}
 if(path.endsWith('/pulls/7')) {reads++;body=pr();if(state.stale && reads>1) body.head.sha='d'.repeat(40);}
 else if(path.endsWith('/branches/main')) body={commit:{sha:state.base}};
 else if(path.endsWith('/pulls/7/commits')) body=[{sha:state.head,author:{login:state.author,type:state.authorType,id:state.authorId},committer:{login:'web-flow',id:19864447},commit:{verification:{verified:!state.unsigned}}}];
 else if(path.endsWith('/pulls/7/files')) body=state.files.map(filename=>({filename,status:'modified'}));
 else if(path.includes('/contents/')) {const after=url.searchParams.get('ref')===state.head,lock=path.endsWith('package-lock.json');body={type:'file',encoding:'base64',content:Buffer.from(JSON.stringify(lock?(after?state.lockAfter:state.lockBefore):(after?state.after:state.before))).toString('base64')};}
 else if(path.endsWith('/check-runs')) body={total_count:checks.length,check_runs:checks.map((check,i)=>({id:i+1,name:check.context,head_sha:state.head,app:{id:state.wrongCheckApp?1:check.integration_id},status:'completed',conclusion:state.failed || state.vulnerable && check.context==='Enforce Factory secret and dependency policy'?'failure':'success'}))};
 else if(path.endsWith('/status')) body={state:'success',total_count:0,statuses:[]};
 else if(path.endsWith('/reviews')) body=state.reviews;
 else if(path.endsWith('/permission')) body={permission:'admin'};
 else throw new Error(`Unexpected fixture request ${path}`);
 return Response.json(body);
};
