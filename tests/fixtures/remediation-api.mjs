import {readFileSync,writeFileSync} from 'node:fs';
const filename=process.env.FACTORY_TEST_API;
const data=JSON.parse(readFileSync(filename,'utf8'));
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url),p=u.pathname,request=options.body?JSON.parse(options.body):{};let body;
 if(p.endsWith('/permission')) body={permission:data.permission,user:{login:data.actor,type:'User'}};
 else if(p==='/user') body={login:data.actor,type:'User'};
 else if(p==='/app') body={id:5180250,slug:'factory'};
 else if(p.endsWith('/access_tokens')) body={token:'temporary-app-fixture',permissions:{contents:'read',pull_requests:'write'}};
 else if(p==='/installation/token') return new Response(null,{status:204});
 else if(p.endsWith('/git/ref/heads/main')) body={object:{sha:data.sha}};
 else if(p.includes('/git/ref/heads/feat/source')) body={object:{sha:data.source_sha}};
 else if(p.includes('/git/ref/heads/feat/factory-remediation-')) {if(!data.fixed || data.deletedBranch) return new Response('{}',{status:404});body={object:{sha:'e'.repeat(40)}};}
 else if(p==='/graphql') {const input=request.variables.input;if(!input.branch.branchName || input.branch.refName) return new Response(JSON.stringify({errors:[{message:'Invalid branch input'}]}),{status:200});data.fixed=true;data.formatted=Buffer.from(input.fileChanges.additions[0].contents,'base64').toString('utf8');data.message=input.message.headline;body={data:{createCommitOnBranch:{commit:{oid:'e'.repeat(40),signature:{isValid:data.signature!==false}}}}};}
 else if(p.includes('/contents/')) {const content=u.searchParams.get('ref')==='e'.repeat(40)?data.formatted:data.content;body={type:'file',encoding:'base64',size:Buffer.byteLength(content),content:Buffer.from(content).toString('base64'),sha:'b'.repeat(40)};}
 else if(p==='/installation/repositories') body={repositories:[{full_name:'org/repo'}]};
 else if(p.includes('/git/commits/')) body={tree:{sha:'a'.repeat(40)},message:data.message,parents:[{sha:data.source_sha}]};
 else if(p.includes('/commits/')) body={commit:{verification:{verified:data.signature!==false}}};
 else if(p.endsWith('/git/refs')) body={object:{sha:request.sha}};
 else if(p.includes('/compare/')) body={files:[{filename:'src/data.json',status:'modified'}],commits:[{sha:'e'.repeat(40)}]};
 else if(p.endsWith('/pulls') && options.method==='POST') {data.pr=true;body={number:7,head:{sha:'e'.repeat(40)},user:{login:data.app_actor},html_url:'https://github.com/org/repo/pull/7'};}
 else if(p.endsWith('/pulls')) body=data.pr?[{head:{sha:'e'.repeat(40)},user:{login:data.app_actor},html_url:'https://github.com/org/repo/pull/7'}]:[];
 else if(p.includes('/issues/comments/')) body={body:data.comment_body,user:{login:data.actor,type:'User'}};
 else if(/\/pulls\/[0-9]+$/.test(p)) body={state:'open',head:{repo:{full_name:data.fork?'outside/fork':'org/repo'},ref:'feat/source',sha:data.source_sha},base:{ref:'main'}};
 else throw new Error('Unexpected external API '+p);
 if(options.method && options.method!=='GET') {data.writes=(data.writes??0)+1;writeFileSync(filename,JSON.stringify(data));}
 return new Response(JSON.stringify(body),{status:200});
};
