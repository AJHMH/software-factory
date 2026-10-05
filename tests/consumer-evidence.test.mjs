import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
function fixture(t) {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const dir = mkdtempSync(join(root, 'tmp/consumer-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const revision = 'a'.repeat(40), trusted = 'b'.repeat(40), base = 'c'.repeat(40), head = 'd'.repeat(40), digest = 'e'.repeat(64);
  const reports = {};
  for (const [name, operation] of Object.entries({validation:'validate',policy:'policy',coverage:'coverage',security:'security',sast:'sast',human_review:'human-review'})) {
    reports[name] = {operation,outcome:'passed',revision:name==='human_review'?head:revision,trustedRevision:trusted,baseRevision:base,contractDigest:digest,evidenceDigest:digest,policyDigest:digest,qualityDigest:digest,results:[{capability:operation,status:'passed',required:true}]};
  }
  const save = () => { for (const [name, report] of Object.entries(reports)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(report)); };
  const run = () => { save(); const result = spawnSync(process.execPath, [join(root,'scripts/factory-validation.mjs'),'consumer-evidence','--reports-directory',dir,'--source-revision',revision,'--trusted-revision',trusted,'--base-revision',base,'--review-head',head,'--output',join(dir,'bundle.json')], {encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:''}}); return {...result,report:JSON.parse(result.stdout)}; };
  return {dir,reports,revision,head,run};
}

test('public consumer evidence assembly preserves six reports and keeps reviewed head separate from merge revision', t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.operation, 'consumer-evidence');
  assert.equal(result.report.certification, 'not-run');
  assert.equal(result.report.bundle.revision, f.revision);
  assert.equal(result.report.bundle.reports.human_review.revision, f.head);
  assert.deepEqual(result.report.bundle.reports, f.reports);
});

test('public evidence assembly rejects failed, stale, mismatched and incomplete gate reports without writing a bundle', t => {
  for (const mutate of [f=>{f.reports.security.outcome='blocked';},f=>{f.reports.coverage.baseRevision='f'.repeat(40);},f=>{f.reports.policy.trustedRevision='f'.repeat(40);},f=>{f.reports.sast.revision='f'.repeat(40);},f=>{f.reports.human_review.revision=f.revision;},f=>{f.reports.validation.results=[];},f=>{delete f.reports.policy.policyDigest;},f=>{f.reports.security.results[0].status='error';}]) {
    const f=fixture(t);mutate(f);const result=f.run();assert.equal(result.status,1,result.stdout);assert.equal(result.report.outcome,'blocked');assert.equal(result.report.certification,'not-run');assert.equal(existsSync(join(f.dir,'bundle.json')),false);
  }
});
