import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test from 'node:test';
import {generateKeyPairSync} from 'node:crypto';
import {tmpdir} from 'node:os';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(t) {
  mkdirSync(join(root,'tmp'),{recursive:true});const dir=mkdtempSync(join(root,'tmp/remediation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const repo=join(dir,'repo');mkdirSync(join(repo,'policies'),{recursive:true});mkdirSync(join(repo,'src'));
  const policy={version:'1.0',agents:{remediation:{allowed_callers:['owner'],app_actor:'factory[bot]'},runner:{max_retries:0,max_duration_ms:10000,budget_microusd:100000,cost_per_attempt_microusd:100000,max_actions:1,max_total_bytes:65536,retention_days:30,allowed_paths:['src/'],restricted_paths:['policies/']}}};
  writeFileSync(join(repo,'policies/agents.yaml'),JSON.stringify(policy));writeFileSync(join(repo,'src/data.json'),'{"value":1}\n');
  const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};git('init');git('add','.');git('-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');const sha=git('rev-parse','HEAD');
  const event={sender:{login:'owner',type:'User'},repository:{full_name:'org/repo'},inputs:{source_branch:'feat/source',source_sha:sha,path:'src/data.json',operation:'format-json'}};
  const api={sha,source_sha:sha,content:'{"value":1}\n',permission:'write',actor:'owner',app_actor:'factory[bot]'};
  const run=(mode='prepare',name='workflow_dispatch',host={})=>{writeFileSync(join(dir,'event.json'),JSON.stringify(event));writeFileSync(join(dir,'api.json'),JSON.stringify(api));const r=spawnSync(process.execPath,['--import',pathToFileURL(join(root,'tests/fixtures/remediation-api.mjs')).href,join(root,'scripts/factory-validation.mjs'),'remediate','--trusted-repo',repo,'--trusted-revision',sha,'--repository-path',repo,'--repository','org/repo','--state-dir',join(dir,'state'),'--mode',mode],{encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:name,GITHUB_EVENT_PATH:join(dir,'event.json'),GITHUB_ACTOR:'owner',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_REF:'refs/heads/main',FACTORY_GITHUB_TOKEN:'read-fixture',FACTORY_PUSH_TOKEN:'write-fixture',FACTORY_PR_TOKEN:'app-fixture',FACTORY_TEST_API:join(dir,'api.json'),...host}});return {...r,report:r.stdout?JSON.parse(r.stdout):null};};
  const runLocal=(mode='prepare',extra=[])=>{writeFileSync(join(dir,'api.json'),JSON.stringify(api));const r=spawnSync(process.execPath,['--import',pathToFileURL(join(root,'tests/fixtures/remediation-api.mjs')).href,join(root,'scripts/factory-validation.mjs'),'local-remediate','--trusted-repo',repo,'--trusted-revision',sha,'--repository-path',repo,'--repository','org/repo','--state-dir',join(dir,'state'),'--mode',mode,'--source-branch','feat/source','--source-revision',api.source_sha,'--path','src/data.json','--request-id','789',...extra],{encoding:'utf8',env:{...process.env,FACTORY_GITHUB_TOKEN:'read-fixture',FACTORY_TEST_API:join(dir,'api.json')}});return {...r,report:r.stdout?JSON.parse(r.stdout):null};};
  return {dir,repo,sha,event,api,run,runLocal,git};
}
test('authorized exact-revision request prepares a genuine bounded JSON formatting fix without changing its source',t=>{
  const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.report.outcome,'passed');assert.equal(r.report.revision,f.sha);assert.equal(r.report.actor,'owner');assert.equal(r.report.runner.attempts,1);assert.equal(readFileSync(join(f.repo,'src/data.json'),'utf8'),'{"value":1}\n');assert.ok(!r.stdout.includes('read-fixture'));
});
test('an unauthorized caller is denied before runner reservation or any remote write',t=>{
 const f=fixture(t);f.api.permission='read';const r=f.run('publish');assert.equal(r.status,1);assert.equal(r.report.runner,undefined);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes,undefined);
});
test('publishing creates one genuine fix PR and replay performs no additional writes or spending',t=>{
 const f=fixture(t),r=f.run('publish');assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.report.pullRequest,'https://github.com/org/repo/pull/7');assert.equal(r.report.fixRevision,'e'.repeat(40));const writes=JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes;
 Object.assign(f.api,JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')));const replay=f.run('publish');assert.equal(replay.status,0,replay.stdout);assert.equal(replay.report.replay,true);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes,writes);
});

test('hostile types, lengths, shell text, paths and stale revisions never execute the runner',t=>{
 const f=fixture(t),valid={...f.event.inputs};
 for(const change of [{path:'src/../../policies/agents.json'},{source_branch:'feat/x; echo pwned'},{path:['src/data.json']},{path:'src/'+ 'x'.repeat(200)+'.json'},{operation:'shell'},{source_sha:'f'.repeat(40)},{extra:'arbitrary command'}]) {
  f.event.inputs={...valid,...change};const r=f.run('publish');assert.equal(r.status,1,r.stdout);assert.equal(r.report.runner,undefined);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes,undefined);
 }
 f.event.inputs=valid;f.api.sha='f'.repeat(40);assert.equal(f.run().report.runner,undefined);
});
test('supported dispatch and PR comments are authorized, while forged comments and forks are denied',t=>{
 const f=fixture(t);f.event.action='factory-remediate';f.event.client_payload=f.event.inputs;assert.equal(f.run('authorize','repository_dispatch').status,0);
 f.event.action='created';f.event.comment={id:456,body:`/factory format-json feat/source ${f.sha} src/data.json`};f.event.issue={number:1,pull_request:{}};f.api.comment_body=f.event.comment.body;
 assert.equal(f.run('authorize','issue_comment').status,0);f.api.fork=true;assert.equal(f.run('publish','issue_comment').status,1);f.api.fork=false;f.api.comment_body='changed body';assert.equal(f.run('publish','issue_comment').status,1);
});
test('JSON requiring no fix creates no PR and invalid JSON never reserves a runner attempt',t=>{
 const f=fixture(t);
 for(const content of ['{\n  "value": 1\n}\n'.replaceAll('\\n','\n'),'{"invalid":','{}\n']) {
  writeFileSync(join(f.repo,'src/data.json'),content);f.git('add','.');f.git('-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','data fixture');const sha=f.git('rev-parse','HEAD');f.event.inputs.source_sha=sha;f.api.source_sha=sha;f.api.content=content;
  const r=f.run('publish');assert.equal(r.status,1,r.stdout);assert.equal(r.report.runner,undefined);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes,undefined);
 }
});
test('formatting preserves large numeric tokens and duplicate keys byte-for-byte apart from whitespace',t=>{
 const f=fixture(t),content='{"n":123456789012345678901,"n":2}\n';writeFileSync(join(f.repo,'src/data.json'),content);const r=spawnSync('git',['-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-am','numeric fixture'],{cwd:f.repo});assert.equal(r.status,0);
 // This case is exercised in its own source commit; authority stays pinned to the fixture's policy commit.
 const sha=spawnSync('git',['rev-parse','HEAD'],{cwd:f.repo,encoding:'utf8'}).stdout.trim();f.event.inputs.source_sha=sha;f.api.source_sha=sha;f.api.content=content;const result=f.run();assert.equal(result.status,0,result.stdout);const output=readFileSync(join(result.report.runner.workspace,'src/data.json'),'utf8');assert.ok(output.includes('123456789012345678901'));assert.equal(output.match(/"n"/g).length,2);
});

test('an unverified fix commit never opens a PR',t=>{
 const f=fixture(t);f.api.signature=false;const r=f.run('publish');assert.equal(r.status,1,r.stdout);assert.match(r.report.results[0].reason,/signature/);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).pr,undefined);
});
test('reruns lacking durable evidence and candidate caller-policy changes cannot authorize new execution',t=>{
 const f=fixture(t);const rerun=f.run('publish','workflow_dispatch',{GITHUB_RUN_ATTEMPT:'2'});assert.equal(rerun.status,1);assert.equal(rerun.report.runner,undefined);assert.match(rerun.report.results[0].reason,/recovery/);
 const policy=JSON.parse(readFileSync(join(f.repo,'policies/agents.yaml'),'utf8'));policy.agents.remediation.allowed_callers.push('attacker');writeFileSync(join(f.repo,'policies/agents.yaml'),JSON.stringify(policy));f.event.sender.login='attacker';f.api.actor='attacker';
 const attack=f.run('publish','workflow_dispatch',{GITHUB_ACTOR:'attacker'});assert.equal(attack.status,1);assert.equal(attack.report.runner,undefined);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes,undefined);
});
test('local preparation authenticates the signed-in human and produces a proposal for review without App credentials',t=>{
 const f=fixture(t),r=f.runLocal();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.report.actor,'owner');assert.equal(r.report.event,'local_manual');assert.equal(r.report.runner.proposalDigest.length,64);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes,undefined);
});
test('local publication requires approval of the precise prepared digest before reading an App key',t=>{
 const f=fixture(t),prepared=f.runLocal();assert.equal(prepared.status,0,prepared.stdout);
 for(const args of [[],['--approve','true','--expected-proposal-digest','0'.repeat(64)],['--approve','false','--expected-proposal-digest',prepared.report.proposalDigest]]) {
  const r=f.runLocal('publish',[...args,'--private-key-path',join(f.dir,'missing.pem')]);assert.equal(r.status,1);assert.match(r.report.results[0].reason,/App key was not loaded/);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes,undefined);
 }
});
test('an approved local proposal opens a signed App-authored PR and replays without loading credentials again',t=>{
 const f=fixture(t),prepared=f.runLocal();assert.equal(prepared.status,0,prepared.stdout);const keyDirectory=mkdtempSync(join(tmpdir(),'factory-app-test-'));t.after(()=>rmSync(keyDirectory,{recursive:true,force:true}));const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey,keyPath=join(keyDirectory,'fixture.pem');writeFileSync(keyPath,key);
 const args=['--approve','true','--expected-proposal-digest',prepared.report.proposalDigest,'--private-key-path',keyPath];const published=f.runLocal('publish',args);assert.equal(published.status,0,published.stdout+published.stderr);assert.equal(published.report.pullRequest,'https://github.com/org/repo/pull/7');assert.equal(published.report.runner.cost.spentMicrousd,100000);assert.ok(!published.stdout.includes(key));
 Object.assign(f.api,JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')));f.api.deletedBranch=true;const writes=f.api.writes;const replay=f.runLocal('publish',[...args.slice(0,4),'--private-key-path',join(f.dir,'missing.pem')]);assert.equal(replay.status,0,replay.stdout);assert.equal(replay.report.replay,true);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes,writes);
});
test('even an approved local proposal rejects a valid App key stored inside the source repository',t=>{
 const f=fixture(t),prepared=f.runLocal();assert.equal(prepared.status,0,prepared.stdout);const keyPath=join(f.repo,'fixture.pem'),key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;writeFileSync(keyPath,key);
 const r=f.runLocal('publish',['--approve','true','--expected-proposal-digest',prepared.report.proposalDigest,'--private-key-path',keyPath]);assert.equal(r.status,1);assert.equal(JSON.parse(readFileSync(join(f.dir,'api.json'),'utf8')).writes,undefined);assert.ok(!r.stdout.includes(key));
});
