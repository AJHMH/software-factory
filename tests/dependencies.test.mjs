import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test from 'node:test';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(t) {
 mkdirSync(join(root,'tmp'),{recursive:true});const dir=mkdtempSync(join(root,'tmp/dependencies-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const repo=join(dir,'repo');mkdirSync(join(repo,'policies'),{recursive:true});
 for(const name of ['dependencies','human-review','governance']) writeFileSync(join(repo,`policies/${name}.yaml`),readFileSync(join(root,`policies/${name}.yaml`)));
 const manifest=version=>({name:'fixture',version:'1.0.0',dependencies:{yaml:version},scripts:{test:'node --test'}});
 const lock=version=>({name:'fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0',dependencies:{yaml:version}},'node_modules/yaml':{version,resolved:`https://registry.npmjs.org/yaml/-/yaml-${version}.tgz`,integrity:'sha512-'+Buffer.alloc(64).toString('base64')}}});
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const currentManifest={name:'fixture',version:'1.0.0',dependencies:{yaml:'2.9.1'}};
 const updaterLock={name:'fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0',dependencies:{yaml:'2.9.1'}},'node_modules/yaml':{version:'2.9.1',resolved:'https://registry.npmjs.org/yaml/-/yaml-2.9.1.tgz',integrity:'sha512-'+Buffer.alloc(64).toString('base64')}}};
 for(const prefix of ['','examples/reference-workload/']) {mkdirSync(join(repo,prefix),{recursive:true});writeFileSync(join(repo,prefix+'package.json'),JSON.stringify(currentManifest));writeFileSync(join(repo,prefix+'package-lock.json'),JSON.stringify(updaterLock));}
 git('init');git('add','.');git('-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');const base=git('rev-parse','HEAD'),head='b'.repeat(40);
 const state={base,head,author:'dependabot[bot]',authorType:'Bot',authorId:49699333,appId:29110,files:['package.json','package-lock.json'],before:manifest('2.9.0'),after:manifest('2.9.1'),lockBefore:lock('2.9.0'),lockAfter:lock('2.9.1'),reviews:[{id:1,user:{login:'aaron-howard',type:'User'},state:'APPROVED',commit_id:head,submitted_at:'2026-10-04T00:00:00Z'}]};
 const run=(mode='evaluate')=>{writeFileSync(join(dir,'api.json'),JSON.stringify(state));const r=spawnSync(process.execPath,['--import',pathToFileURL(join(root,'tests/fixtures/dependencies-api.mjs')).href,join(root,'scripts/factory-validation.mjs'),'dependencies','--mode',mode,'--trusted-repo',repo,'--trusted-revision',base,'--repository','org/repo','--pull-request','7'],{encoding:'utf8',env:{...process.env,FACTORY_GITHUB_TOKEN:'fixture',FACTORY_TEST_API:join(dir,'api.json')}});return {...r,report:r.stdout?JSON.parse(r.stdout):null,api:JSON.parse(readFileSync(join(dir,'api.json'),'utf8'))};};
 const runUpdate=()=>{writeFileSync(join(dir,'api.json'),JSON.stringify(state));const output=join(dir,'proposals');const r=spawnSync(process.execPath,['--import',pathToFileURL(join(root,'tests/fixtures/dependencies-api.mjs')).href,join(root,'scripts/factory-validation.mjs'),'dependencies','--mode','update','--trusted-repo',repo,'--trusted-revision',base,'--output',output],{encoding:'utf8',env:{...process.env,FACTORY_TEST_API:join(dir,'api.json')}});return {...r,report:r.stdout?JSON.parse(r.stdout):null,proposal:JSON.parse(readFileSync(join(output,'proposal.json'),'utf8')),output};};
 return {state,run,runUpdate,manifest,lock,dir,repo,base,head};
}
test('an independently approved Dependabot patch merges only its inspected SHA',t=>{
 const f=fixture(t),r=f.run('merge');assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.report.outcome,'passed');assert.equal(r.report.proposals[0].merged,true);assert.deepEqual(r.api.merge,{sha:f.head,merge_method:'squash'});
});
test('major and exempt direct or transitive updates require a manual merge',t=>{
 for(const kind of ['major','exempt','transitive']) {
  const f=fixture(t);
  if(kind==='major') {f.state.after=f.manifest('3.0.0');f.state.lockAfter=f.lock('3.0.0');}
  else if(kind==='exempt') {for(const doc of [f.state.before,f.state.after,f.state.lockBefore.packages[''],f.state.lockAfter.packages['']]) {doc.dependencies.react=doc.dependencies.yaml;delete doc.dependencies.yaml;}for(const lock of [f.state.lockBefore,f.state.lockAfter]) {lock.packages['node_modules/react']=lock.packages['node_modules/yaml'];delete lock.packages['node_modules/yaml'];}}
  else {for(const lock of [f.state.lockBefore,f.state.lockAfter]) lock.packages['node_modules/next']={...lock.packages['node_modules/yaml']};}
  const r=f.run('merge');assert.equal(r.status,1,r.stdout);assert.equal(r.api.merge,undefined);assert.match(r.report.proposals[0].reason,/Manual merge required/);
 }
});
test('stale proposals and missing, failed, or spoofed validation never reach the merge endpoint',t=>{
 for(const issue of ['stale','failed','wrongCheckApp','missingApproval','oldApproval','dismissal','scripts','sensitive','downgrade','registry','unsigned','impostor','mergeDenied','metadataMismatch','vulnerable','manifestOnly']) {
  const f=fixture(t);
  if(['stale','failed','wrongCheckApp','unsigned','mergeDenied','metadataMismatch','vulnerable'].includes(issue)) f.state[issue]=true;
  if(issue==='missingApproval') f.state.reviews=[];
  if(issue==='oldApproval') f.state.reviews[0].commit_id='a'.repeat(40);
  if(issue==='dismissal') f.state.reviews.push({...f.state.reviews[0],id:2,state:'DISMISSED'});
  if(issue==='scripts') f.state.after.scripts.test='echo forged';
  if(issue==='sensitive') f.state.files.push('.github/workflows/factory-security.yml');
  if(issue==='downgrade') {f.state.after=f.manifest('2.8.0');f.state.lockAfter=f.lock('2.8.0');}
  if(issue==='registry') f.state.lockAfter.packages['node_modules/yaml'].resolved='https://attacker.invalid/yaml.tgz';
  if(issue==='manifestOnly') {f.state.lockAfter=f.lock('2.9.0');f.state.lockAfter.packages[''].dependencies.yaml='2.9.1';}
  if(issue==='impostor') f.state.authorId=123;
  const r=f.run('merge');assert.equal(r.status,1,issue+': '+r.stdout);assert.equal(r.report.proposals[0].merged,false);assert.equal(r.api.merge,undefined,issue);
 }
});
test('evaluation reports eligibility without mutating GitHub',t=>{
 const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stdout);assert.equal(r.report.proposals[0].merged,false);assert.equal(r.api.merge,undefined);
});
test('the public updater inspects trusted manifests and emits revision-bound proposals without GitHub write credentials',t=>{
 const f=fixture(t),r=f.runUpdate();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.report.outcome,'passed');assert.equal(r.report.revision,f.base);assert.equal(r.proposal.revision,f.base);assert.equal(r.proposal.proposals.length,2);assert.ok(r.proposal.proposals.every(proposal=>proposal.changed===false));
});
