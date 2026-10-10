import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url)), cli=join(root,'scripts/factory-validation.mjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(t, profile = 'node-24') {
  mkdirSync(join(root,'tmp'),{recursive:true});
  const repo=mkdtempSync(join(root,'tmp/sast-test-'));
  t.after(()=>{const within=relative(realpathSync(join(root,'tmp')),realpathSync(repo));assert.ok(within && within !== '..' && !within.startsWith('..'+sep) && !isAbsolute(within));rmSync(repo,{recursive:true,force:true});});
  const git=(...args)=>{const result=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  const write=(name,value)=>writeFileSync(join(repo,name),typeof value === 'string' ? value : JSON.stringify(value));
  mkdirSync(join(repo,'policies'));mkdirSync(join(repo,'workload'));
  for (const name of ['security','dependencies','enforcement']) write(`policies/${name}.yaml`,readFileSync(join(root,`policies/${name}.yaml`),'utf8'));
  if (profile === 'node-24-typescript-cli') {
    mkdirSync(join(repo, 'profiles'));
    for (const name of ['workloads', 'codeql']) write('profiles/' + name + '.yaml', readFileSync(join(root, 'profiles/' + name + '.yaml'), 'utf8'));
  }
  const contract={version:'1.0',contract:{workload_id:'sast-workload',profile,working_directory:'workload',commands:Object.fromEntries(['install','validate','test','build'].map(name=>[name,{run:'exit 0',timeout_seconds:10}]))}};
  write('factory-contract.yaml',contract);write('workload/index.mjs','export const value=1;\n');git('init');git('add','.');
  git('-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');
  const revision=git('rev-parse','HEAD');
  const evidence={version:'1.0',revision,tree_digest:git('rev-parse','HEAD^{tree}'),contract_digest:hash(JSON.stringify(contract)),workload_id:'sast-workload',profile,analyses:[{id:123,revision,ref:'refs/pull/1/head',language:'javascript-typescript',build_mode:'none',tool_version:'2.27.1',rules_count:87,status:'success',findings:[]}]};
  const run=(command='sast')=>{write('sast.json',evidence);const result=spawnSync(process.execPath,[cli,command,'--trusted-revision',revision,'--trusted-repo',repo,'--contract',join(repo,'factory-contract.yaml'),...(command === 'sast' ? ['--evidence',join(repo,'sast.json')] : ['--repository','AJHMH/software-factory','--ref','refs/heads/main'])],{cwd:root,encoding:'utf8',env:{...process.env,FACTORY_GITHUB_TOKEN:'',GITHUB_STEP_SUMMARY:''}});return {...result,report:result.stdout ? JSON.parse(result.stdout) : null};};
  return {repo,write,git,revision,evidence,run};
}

test('completed exact-revision CodeQL analysis satisfies the SAST gate',t=>{
  const f=fixture(t), result=f.run();assert.equal(result.status,0,result.stderr || result.stdout);assert.equal(result.report.results[0].status,'passed');assert.equal(result.report.revision,f.revision);
});

test('inaccessible native analysis service is an error and cannot be mistaken for a clean scan',t=>{
  const result=fixture(t).run('collect-sast');assert.equal(result.status,1);assert.equal(result.report.results[0].status,'error');assert.equal(result.report.outcome,'blocked');
});

test('high and critical findings deny delivery while medium is a policy warning',t=>{
  const f=fixture(t);
  const finding={rule:'js/command-line-injection',severity:'medium',path:'workload/index.mjs',line:1,help_url:'https://codeql.github.com/codeql-query-help/javascript/js-command-line-injection/'};
  f.evidence.analyses[0].findings=[finding];
  const warning=f.run();assert.equal(warning.status,0);assert.equal(warning.report.warnings,1);
  for (const severity of ['high','critical']) {finding.severity=severity;const denied=f.run();assert.equal(denied.status,1);assert.equal(denied.report.results[0].status,'failed');assert.equal(denied.report.findings[0].rule,'js/command-line-injection');}
});

test('analysis/build errors and stale or incomplete evidence never satisfy mandatory SAST',t=>{
  const f=fixture(t), clean=structuredClone(f.evidence);
  const cases=[e=>{e.revision='a'.repeat(40);},e=>{e.tree_digest='b'.repeat(40);},e=>{e.analyses[0].revision='c'.repeat(40);},e=>{e.analyses[0].status='error';},e=>{e.analyses[0].status='unsupported';},e=>{e.analyses[0].rules_count=0;},e=>{e.analyses=[];},e=>{e.analyses[0].build_mode='manual';},e=>{e.analyses[0].message='must-not-leak-snippets';}];
  for (const mutate of cases) {Object.assign(f.evidence,structuredClone(clean));mutate(f.evidence);const denied=f.run();assert.equal(denied.status,1,denied.stdout);assert.equal(denied.report.outcome,'blocked');assert.ok(!denied.stdout.includes('must-not-leak-snippets'));}
});

test('candidate severity policy cannot authorize its own prohibited findings',t=>{
  const f=fixture(t);
  f.write('policies/security.yaml',readFileSync(join(root,'policies/security.yaml'),'utf8').replace('["critical", "high"]','[]'));
  f.git('add','.');f.git('-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','candidate weakening');
  const revision=f.git('rev-parse','HEAD');f.evidence.revision=revision;f.evidence.tree_digest=f.git('rev-parse','HEAD^{tree}');f.evidence.analyses[0].revision=revision;
  f.evidence.analyses[0].findings=[{rule:'js/command-line-injection',severity:'high',path:'workload/index.mjs',line:1,help_url:'https://codeql.github.com/codeql-query-help/javascript/js-command-line-injection/'}];
  assert.equal(f.run().status,1);
});

test('public SAST collector accepts only an advanced analysis identity selected by trusted profile', t => {
  const f=fixture(t);
  mkdirSync(join(f.repo,'profiles'));
  f.write('profiles/codeql.yaml', 'version: "1.0"\nprofiles:\n  - id: node-24\n    language: javascript-typescript\n    build_mode: none\n    category: /language:javascript-typescript\n    analysis_keys: [".github/workflows/codeql.yml:analyze"]\n');
  f.git('add','.');f.git('-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','trusted profile');
  const revision=f.git('rev-parse','HEAD'), preload=join(f.repo,'api.mjs');
  const metadata={id:123,commit_sha:revision,ref:'refs/heads/main',category:'/language:javascript-typescript',analysis_key:'.github/workflows/codeql.yml:analyze',tool:{name:'CodeQL',version:'2.27.1'},error:'',warning:'',rules_count:1,results_count:0};
  const sarif={version:'2.1.0',runs:[{tool:{driver:{name:'CodeQL',semanticVersion:'2.27.1',rules:[{id:'js/test'}]}},results:[],versionControlProvenance:[{revisionId:revision,repositoryUri:'https://github.com/AJHMH/software-factory'}]}]};
  f.write('api.mjs',`globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('analyses/123')?${JSON.stringify(sarif)}:[${JSON.stringify(metadata)}]),{status:200});`);
  const result=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,cli,'collect-sast','--trusted-revision',revision,'--trusted-repo',f.repo,'--contract',join(f.repo,'factory-contract.yaml'),'--repository','AJHMH/software-factory','--ref','refs/heads/main','--analysis-key','.github/workflows/codeql.yml:analyze'],{cwd:root,encoding:'utf8',env:{...process.env,FACTORY_GITHUB_TOKEN:'fixture-token',GITHUB_STEP_SUMMARY:''},timeout:10000});
  assert.equal(result.status,0,result.stdout || result.stderr);
  assert.equal(JSON.parse(result.stdout).outcome,'passed');
  const denied=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,cli,'collect-sast','--trusted-revision',revision,'--trusted-repo',f.repo,'--contract',join(f.repo,'factory-contract.yaml'),'--repository','AJHMH/software-factory','--ref','refs/heads/main','--analysis-key','.github/workflows/unapproved.yml:analyze'],{cwd:root,encoding:'utf8',env:{...process.env,FACTORY_GITHUB_TOKEN:'fixture-token',GITHUB_STEP_SUMMARY:''}});
  assert.equal(denied.status,1);assert.equal(JSON.parse(denied.stdout).outcome,'blocked');
});


test('CLI profile accepts clean sast evidence and rejects mismatched or unknown profiles', t => {
  const f = fixture(t, 'node-24-typescript-cli');
  const passed = f.run();
  assert.equal(passed.status, 0, passed.stderr || passed.stdout);
  assert.ok(passed.report.results.every(result => result.status === 'passed'));
  for (const profile of ['node-24', 'unrecognized-profile']) {
    f.evidence.profile = profile;
    const denied = f.run();
    assert.equal(denied.status, 1, denied.stdout);
    assert.equal(denied.report.outcome, 'blocked');
  }
});

test('CLI profile still blocks prohibited SAST severity', t => {
  const f = fixture(t, 'node-24-typescript-cli');
  f.evidence.analyses[0].findings = [{rule:'js/command-line-injection',severity:'high',path:'workload/index.mjs',line:1,help_url:'https://codeql.github.com/codeql-query-help/javascript/js-command-line-injection/'}];
  const denied = f.run();
  assert.equal(denied.status, 1);
  assert.equal(denied.report.results[0].status, 'failed');
});
