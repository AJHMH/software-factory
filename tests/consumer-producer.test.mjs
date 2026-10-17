import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script=resolve('scripts/consumer-producer.mjs');
function fixture(t) {
  const cwd=mkdtempSync(join(tmpdir(),'consumer-producer-'));mkdirSync(join(cwd,'tmp'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const head='a'.repeat(40),base='b'.repeat(40),repository='owner/consumer';
  const pull={number:7,state:'closed',merged:true,merge_commit_sha:'c'.repeat(40),head:{sha:head,repo:{full_name:repository}},base:{sha:base,ref:'main',repo:{full_name:repository}}};
  const run={id:12,repository:{full_name:repository},head_sha:head,head_branch:'codex/task',event:'pull_request',path:'.github/workflows/factory-adoption.yml',status:'completed',conclusion:'success',pull_requests:[{number:7,head:{sha:head},base:{sha:base}}]};
  const evidence={revision:head,reports:{coverage:{baseRevision:base}}};
  const env={...process.env,PRODUCER_RUN_ID:'12',REPOSITORY:repository,SOURCE_REVISION:head,PULL_REQUEST:'7'};
  const execute=()=>{
    writeFileSync(join(cwd,'tmp/producer.json'),JSON.stringify(run));writeFileSync(join(cwd,'tmp/producer-pull.json'),JSON.stringify(pull));
    return spawnSync(process.execPath,[script],{cwd,encoding:'utf8',env:{...env,EVIDENCE_BUNDLE:JSON.stringify(evidence)}});
  };
  return {cwd,pull,run,evidence,env,execute};
}

test('certification accepts a successful exact-head PR producer without a main push',t=>{
  const f=fixture(t),result=f.execute();assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(f.cwd,'tmp/evidence.json'),'utf8')),f.evidence);
});

test('wrong producer, PR, source, base, fork, event, workflow or failed run cannot supply a package',t=>{
  for(const mutate of [
    f=>{f.run.id=13;},f=>{f.run.repository.full_name='other/repo';},f=>{f.run.head_sha='d'.repeat(40);},
    f=>{f.run.event='push';},f=>{f.run.event='workflow_dispatch';},f=>{f.run.path='.github/workflows/other.yml';},
    f=>{f.run.status='in_progress';},f=>{f.run.conclusion='failure';},f=>{f.run.pull_requests=[];},
    f=>{f.run.pull_requests[0].number=8;},f=>{f.run.pull_requests[0].base.sha='d'.repeat(40);},
    f=>{f.pull.merged=false;},f=>{f.pull.head.repo.full_name='fork/consumer';},f=>{f.pull.base.ref='other';},
    f=>{f.evidence.revision='d'.repeat(40);},f=>{f.evidence.reports.coverage.baseRevision='d'.repeat(40);},
  ]) {
    const f=fixture(t);mutate(f);assert.notEqual(f.execute().status,0);assert.equal(existsSync(join(f.cwd,'tmp/evidence.json')),false);
  }
});
