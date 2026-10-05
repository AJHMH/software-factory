import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';

const root=fileURLToPath(new URL('../',import.meta.url)), cli=join(root,'scripts/factory-validation.mjs');
function fixture(t,agents=[],reviewers=undefined,critical=2) {
  mkdirSync(join(root,'tmp'),{recursive:true});
  const repo=mkdtempSync(join(root,'tmp/review-test-'));
  t.after(()=>{const within=relative(realpathSync(join(root,'tmp')),realpathSync(repo));assert.ok(within && within !== '..' && !within.startsWith('..'+sep) && !isAbsolute(within));rmSync(repo,{recursive:true,force:true});});
  const git=(...args)=>{const result=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  const write=(name,value)=>{mkdirSync(join(repo,name,'..'),{recursive:true});writeFileSync(join(repo,name),typeof value === 'string' ? value : JSON.stringify(value));};
  const commit=()=>{git('add','.');git('-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');return git('rev-parse','HEAD');};
  const policy=parse(readFileSync(join(root,'policies/human-review.yaml'),'utf8'));
  policy.human_review.agent_accounts=agents;policy.human_review.approvals_required.critical_paths=critical;
  if(reviewers) policy.human_review.human_approvers=reviewers;else delete policy.human_review.human_approvers;
  write('policies/human-review.yaml',policy);
  for(const name of ['quality','enforcement']) write(`policies/${name}.yaml`,readFileSync(join(root,`policies/${name}.yaml`),'utf8'));
  write('factory-contract.yaml',{version:'1.0',contract:{workload_id:'reviews',profile:'node-24',working_directory:'workload',commands:Object.fromEntries(['install','validate','test','build'].map(name=>[name,{run:'exit 0',timeout_seconds:10}]))}}); write('workload/src/index.mjs','export const value=1;\n');write('src/auth/token.mjs','export const authenticated=true;\n');write('README.md','base\n');git('init');const base=commit();
  write('README.md','candidate\n');let revision=commit();
  const evidence={version:'1.0',repository:'owner/repo',pull_request:1,revision,base_revision:base,author:'author',reviews:[{id:1,login:'reviewer',type:'User',state:'APPROVED',commit_id:revision,submitted_at:'2026-10-01T00:00:00Z',permission:'write'}]};
  const run=(extra=[])=>{write('reviews.json',evidence);const result=spawnSync(process.execPath,[cli,'human-review','--trusted-revision',base,'--base-revision',base,'--contract',join(repo,'factory-contract.yaml'),'--repository','owner/repo','--pull-request','1','--evidence',join(repo,'reviews.json'),...extra],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:''}});return {...result,report:result.stdout ? JSON.parse(result.stdout) : null};};
  const change=(name,value)=>{write(name,value);revision=commit();evidence.revision=revision;for(const review of evidence.reviews) review.commit_id=revision;};
  return {repo,write,git,base,evidence,run,change};
}

test('ordinary changes require one current independent human approval',t=>{
  const f=fixture(t), result=f.run();assert.equal(result.status,0,result.stderr || result.stdout);assert.equal(result.report.requiredApprovals,1);assert.equal(result.report.approvals.length,1);
  f.evidence.reviews=[];assert.equal(f.run().status,1);
});

test('a sole authorized human can approve a sensitive factory-authored PR',t=>{
  const f=fixture(t,[],['aaron-howard'],1);f.change('scripts/sensitive.mjs','export const value=1;\n');
  f.evidence.author='factory-bot[bot]';f.evidence.reviews[0].login='aaron-howard';
  const approved=f.run();assert.equal(approved.status,0,approved.stdout);assert.equal(approved.report.requiredApprovals,1);
  f.evidence.reviews[0].login='other-human';assert.equal(f.run().status,1,'the configured human owner must approve');
  f.evidence.reviews[0].login='aaron-howard';f.evidence.reviews[0].type='Bot';assert.equal(f.run().status,1);
  f.evidence.reviews[0].type='User';f.evidence.author='aaron-howard';assert.equal(f.run().status,1,'owner-authored PRs cannot be self-approved');
});

test('candidate policy cannot weaken the two-distinct-reviewer requirement for sensitive paths',t=>{
  const f=fixture(t);f.change('policies/human-review.yaml',readFileSync(join(root,'policies/human-review.yaml'),'utf8').replace('critical_paths: 2','critical_paths: 1'));
  const denied=f.run();assert.equal(denied.status,1);assert.equal(denied.report.requiredApprovals,2);
  f.evidence.reviews.push({...f.evidence.reviews[0],id:2});assert.equal(f.run().status,1,'one reviewer cannot count twice');
  f.evidence.reviews[1].login='second-reviewer';assert.equal(f.run().status,0);
});

test('moving a file out of an authentication directory preserves its sensitive-path requirement',t=>{
  const f=fixture(t);f.git('mv','src/auth/token.mjs','auth-moved.mjs');f.change('README.md','renamed authentication code\n');
  const result=f.run();assert.equal(result.status,1);assert.equal(result.report.requiredApprovals,2);assert.ok(result.report.criticalPaths.includes('src/auth/token.mjs'));
});

test('stale, dismissed, bot, author and read-only approvals never authorize a head',t=>{
  const f=fixture(t), original=structuredClone(f.evidence.reviews[0]);
  for(const change of [{commit_id:'a'.repeat(40)},{state:'DISMISSED'},{type:'Bot'},{login:'agent[bot]'},{login:'author'},{permission:'read'}]) {
    f.evidence.reviews=[{...original,...change}];assert.equal(f.run().status,1,JSON.stringify(change));
  }
  f.evidence.reviews=[original,{...original,id:2,state:'CHANGES_REQUESTED'}];assert.equal(f.run().status,1);
  f.evidence.reviews=[original,{...original,id:2,state:'COMMENTED'}];assert.equal(f.run().status,0,'comments preserve a prior approval');
  f.evidence.reviews=[original,{...original,id:2,state:'DISMISSED'}];assert.equal(f.run().status,1,'dismissal invalidates the earlier approval');
});

test('large changes and database migrations require critical approval counts',t=>{
  const large=fixture(t);large.change('README.md','line\n'.repeat(501));const denied=large.run();assert.equal(denied.status,1);assert.ok(denied.report.triggers.includes('changed-line-limit'));
  const database=fixture(t);database.change('migrations/001.sql','CREATE TABLE test (id INTEGER);\n');const schema=database.run();assert.equal(schema.status,1);assert.ok(schema.report.triggers.includes('database-schema'));
});

test('malformed, incomplete and out-of-scope approval evidence fails closed',t=>{
  const f=fixture(t), original=structuredClone(f.evidence);
  for(const mutate of [e=>{e.revision='a'.repeat(40);},e=>{e.base_revision='a'.repeat(40);},e=>{e.repository='other/repo';},e=>{e.pull_request=2;},e=>{delete e.reviews;},e=>{e.reviews.push(e.reviews[0]);},e=>{e.reviews[0].submitted_at='2099-01-01T00:00:00Z';}]) {
    Object.assign(f.evidence,structuredClone(original));mutate(f.evidence);assert.equal(f.run().status,1);
  }
});

test('agents using registered User accounts cannot grant approval',t=>{
  const f=fixture(t,['reviewer']);assert.equal(f.run().status,1);
});

test('coverage decreases require additional humans and missing or stale comparisons block',t=>{
  const f=fixture(t);f.change('workload/src/index.mjs','export const value=2;\n');assert.equal(f.run().status,1,'missing coverage comparison');
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const file=(source,hits)=>({path:'workload/src/index.mjs',source_digest:hash(source),lines:{1:hits},branches:[{id:'1',line:1,end_line:1,hits}]});
  const coverage={version:'1.0',revision:f.evidence.revision,base_revision:f.base,workload_id:'reviews',profile:'node-24',contract_digest:hash(readFileSync(join(f.repo,'factory-contract.yaml'),'utf8')),files:[file('export const value=2;\n',0)],baseline:{revision:f.base,files:[file('export const value=1;\n',1)]},tests:{unit:{revision:f.evidence.revision,status:'passed',exit_code:0},integration:{revision:f.evidence.revision,status:'passed',exit_code:0}}};
  const run=()=>{f.write('coverage.json',coverage);return f.run(['--coverage-evidence',join(f.repo,'coverage.json')]);};
  const decreased=run();assert.equal(decreased.status,1);assert.ok(decreased.report.triggers.includes('coverage-decrease'));assert.equal(decreased.report.requiredApprovals,2);
  f.evidence.reviews.push({...f.evidence.reviews[0],id:2,login:'second-reviewer'});assert.equal(run().status,0,'review authorization does not waive the separate coverage gate');
  coverage.revision='a'.repeat(40);assert.equal(run().status,1);
});

test('exception owners cannot approve their own proposed exceptions',t=>{
  const f=fixture(t);f.change('policy-exceptions.yaml',{version:'1.0',exceptions:[{id:'exception',rule:'maximum_command_timeout_seconds',value:300,workload_id:'reviews',profile:'node-24',revision:'a'.repeat(40),contract_digest:'a'.repeat(64),reason:'fixture',owner:'reviewer',approver:'second-reviewer',expires_at:'2026-10-04T00:00:00.000Z',evidence_id:'approval'}]});
  f.evidence.reviews.push({...f.evidence.reviews[0],id:2,login:'second-reviewer'});assert.equal(f.run().status,1);
});

test('the live collector enforces GitHub identities, permissions, pagination and a stable PR head',t=>{
  const f=fixture(t);
  const execute=(mode)=>{
    const transcript={mode,revision:f.evidence.revision,base:f.base};
    f.write('api-fixture.json',transcript);
    f.write('api-preload.mjs',`import {readFileSync} from 'node:fs';
      const fixture=JSON.parse(readFileSync(new URL('./api-fixture.json',import.meta.url),'utf8'));let requests=0;
      globalThis.fetch=async (value,options)=>{
        const url=new URL(value);if(url.origin !== 'https://api.github.com') throw new Error('Unexpected host');
        let data;
        if(url.pathname.endsWith('/reviews')) {
          const page=Number(url.searchParams.get('page'));
          const review={id:101,user:{login:'reviewer',type:fixture.mode === 'bot' ? 'Bot' : 'User'},state:'APPROVED',commit_id:fixture.mode === 'stale' ? 'a'.repeat(40) : fixture.revision,submitted_at:'2026-10-01T00:00:00Z'};
          data=page === 1 ? Array.from({length:100},(_,index)=>({...review,id:index+1,state:'COMMENTED'})) : [review];
        } else if(url.pathname.endsWith('/permission')) data={permission:fixture.mode === 'read-only' ? 'read' : 'write'};
        else {requests++;data={state:fixture.mode === 'merged' ? 'closed' : 'open',merged:fixture.mode === 'merged',merge_commit_sha:fixture.revision,head:{sha:fixture.mode === 'race' && requests > 1 ? 'b'.repeat(40) : fixture.revision},base:{sha:fixture.base,repo:{full_name:'owner/repo'}},user:{login:'author'}};}
        if(fixture.mode === 'merged' && options.headers['X-GitHub-Api-Version'] !== '2022-11-28') delete data.merge_commit_sha;
        return new Response(JSON.stringify(data),{status:200});
      };`);
    const result=spawnSync(process.execPath,['--import',pathToFileURL(join(f.repo,'api-preload.mjs')).href,cli,'collect-reviews',...(mode === 'merged' ? ['--merged-revision',f.evidence.revision] : []),'--trusted-revision',f.base,'--base-revision',f.base,'--contract',join(f.repo,'factory-contract.yaml'),'--repository','owner/repo','--pull-request','1'],{cwd:root,encoding:'utf8',env:{...process.env,FACTORY_GITHUB_TOKEN:'fixture-not-a-secret',GITHUB_STEP_SUMMARY:''}});
    assert.ok(result.stdout,result.stderr);
    return {...result,report:JSON.parse(result.stdout)};
  };
  assert.equal(execute('human').status,0,'approval on the second page is evaluated');
  assert.equal(execute('merged').status,0,'merged source binds current live approval to its original head and baseline');
  for(const mode of ['bot','stale','read-only','race']) assert.equal(execute(mode).status,1,mode);
});
