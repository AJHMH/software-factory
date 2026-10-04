import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(t) {
  mkdirSync(join(root,'tmp'),{recursive:true});
  const repo=mkdtempSync(join(root,'tmp/governance-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));
  const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  mkdirSync(join(repo,'policies'));writeFileSync(join(repo,'policies/governance.yaml'),JSON.stringify({version:1,governance:{repository_protection:{required_checks:[{context:'Trusted gate',integration_id:15368}],minimum_approvals:1}}}));
  git('init');git('add','.');git('-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','trusted');const sha=git('rev-parse','HEAD');
  const evidence={repository:'owner/repo',default_branch:'main',rulesets:[{id:1,name:'Factory governed default branch',target:'branch',source_type:'Repository',enforcement:'active',bypass_actors:[],conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'deletion'},{type:'non_fast_forward'},{type:'required_linear_history'},{type:'required_signatures'},{type:'pull_request',parameters:{required_approving_review_count:1,dismiss_stale_reviews_on_push:true,required_review_thread_resolution:true}},{type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,do_not_enforce_on_create:false,required_status_checks:[{context:'Trusted gate',integration_id:15368}]}}]}]};
  const run=()=>{writeFileSync(join(repo,'evidence.json'),JSON.stringify(evidence));const r=spawnSync(process.execPath,[join(root,'scripts/factory-validation.mjs'),'governance','--repository','owner/repo','--trusted-repo',repo,'--trusted-revision',sha,'--evidence',join(repo,'evidence.json')],{encoding:'utf8'});return {...r,report:r.stdout?JSON.parse(r.stdout):null};};
  const hosted=(command='collect-governance',extra=[],denied=undefined)=>{
    const filename=join(repo,'api.json');writeFileSync(filename,JSON.stringify({...evidence,denied}));
    const r=spawnSync(process.execPath,['--import',pathToFileURL(join(root,'tests/fixtures/governance-api.mjs')).href,join(root,'scripts/factory-validation.mjs'),command,'--repository','owner/repo','--trusted-repo',repo,'--trusted-revision',sha,...extra],{encoding:'utf8',env:{...process.env,FACTORY_GITHUB_TOKEN:'fixture-not-a-credential',GOVERNANCE_API_FIXTURE:filename}});
    return {...r,report:r.stdout?JSON.parse(r.stdout):null,state:JSON.parse(readFileSync(filename,'utf8'))};
  };
  return {evidence,run,repo,hosted};
}
test('a compliant protected default branch passes the public governance interface',t=>{
  const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.report.outcome,'passed');assert.equal(r.report.enforcementEvidence,'supplied snapshot; live enforcement not established');
});
test('opt-in bootstrap repairs managed protections while preserving unrelated and stronger settings',t=>{
  const f=fixture(t);f.evidence.rulesets[0].rules[4].parameters.required_approving_review_count=2;
  f.evidence.rulesets[0].rules[4].parameters.require_code_owner_review=true;
  f.evidence.rulesets[0].rules=f.evidence.rulesets[0].rules.filter(r=>r.type !== 'required_signatures');
  const unrelated={...structuredClone(f.evidence.rulesets[0]),id:2,name:'Other team policy',target:'tag'};f.evidence.rulesets.push(unrelated);
  assert.equal(f.hosted('bootstrap-governance').status,1,'bootstrap must be explicitly opted into');
  const r=f.hosted('bootstrap-governance',['--apply','true']);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.deepEqual(r.state.rulesets[1],unrelated);assert.equal(r.state.rulesets[0].rules.find(x=>x.type === 'pull_request').parameters.require_code_owner_review,true);
  assert.equal(r.state.rulesets[0].rules.find(x=>x.type === 'pull_request').parameters.required_approving_review_count,2);
  f.evidence.rulesets=r.state.rulesets;assert.equal(f.hosted().status,0);assert.equal(f.hosted('bootstrap-governance',['--apply','true']).state.rulesets.length,2);
});
test('read-only collection reports access and entitlement limitations without enforcement claims',t=>{
  const f=fixture(t);
  for(const status of [403,404,422]) {const r=f.hosted('collect-governance',[],status);assert.equal(r.status,1);assert.match(r.report.results[0].reason,/permission.*entitlement/);assert.match(r.report.results[0].reason,/not established/);assert.deepEqual(r.state.rulesets,f.evidence.rulesets);}
});
test('weakened reviews, signatures, bypass, checks and excluded branches are actionable drift',t=>{
  const f=fixture(t),original=structuredClone(f.evidence);
  for(const weaken of [
    e=>e.rulesets[0].rules.splice(3,1),
    e=>e.rulesets[0].rules[4].parameters.required_approving_review_count=0,
    e=>e.rulesets[0].rules[4].parameters.dismiss_stale_reviews_on_push=false,
    e=>e.rulesets[0].rules[5].parameters.strict_required_status_checks_policy=false,
    e=>e.rulesets[0].rules[5].parameters.required_status_checks[0].integration_id=1,
    e=>e.rulesets[0].bypass_actors.push({actor_type:'Integration',actor_id:1,bypass_mode:'always'}),
    e=>e.rulesets[0].conditions.ref_name.exclude.push('refs/heads/main'),
    e=>e.rulesets[0].enforcement='evaluate',
  ]) {
    Object.assign(f.evidence,structuredClone(original));weaken(f.evidence);
    const r=f.run();assert.equal(r.status,1,r.stdout);assert.ok(r.report.drift.length);assert.ok(r.report.results[0].reason.length);
  }
});
test('stronger inherited controls satisfy policy but candidate policy and wrong identity do not',t=>{
  const f=fixture(t);f.evidence.rulesets[0].source_type='Organization';f.evidence.rulesets[0].rules[4].parameters.required_approving_review_count=2;
  writeFileSync(join(f.repo,'policies/governance.yaml'),'invalid candidate policy');assert.equal(f.run().status,0);
  f.evidence.repository='other/repo';assert.equal(f.run().status,1);
});
test('withheld bypass visibility blocks drift and bootstrap before mutation',t=>{
  const f=fixture(t);delete f.evidence.rulesets[0].bypass_actors;
  const r=f.hosted('bootstrap-governance',['--apply','true']);assert.equal(r.status,1);assert.match(r.report.results[0].reason,/administration-read/);assert.deepEqual(r.state.rulesets,f.evidence.rulesets);
});
