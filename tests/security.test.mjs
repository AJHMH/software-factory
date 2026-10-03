import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/factory-validation.mjs', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');

function fixture(t) {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const repo = mkdtempSync(join(root, 'tmp/security-test-'));
  t.after(() => {
    const within = relative(realpathSync(join(root, 'tmp')), realpathSync(repo));
    assert.ok(within && within !== '..' && !within.startsWith('..' + sep) && !isAbsolute(within));
    rmSync(repo, { recursive: true, force: true });
  });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path, value) => writeFileSync(join(repo, path), typeof value === 'string' ? value : JSON.stringify(value));
  mkdirSync(join(repo, 'policies')); mkdirSync(join(repo, 'workload')); mkdirSync(join(repo, 'workload/tests'));
  for (const name of ['security', 'dependencies', 'enforcement']) write(`policies/${name}.yaml`, readFileSync(join(root, `policies/${name}.yaml`), 'utf8'));
  write('policies/security-dummy-approvals.json', { version: '1.0', approvals: [] });
  const contract = { version: '1.0', contract: { workload_id: 'security-workload', profile: 'node-24', working_directory: 'workload', commands: Object.fromEntries(['install','validate','test','build'].map(name => [name,{run:'exit 0',timeout_seconds:10}])) } };
  write('factory-contract.yaml', contract); write('workload/package.json', {name:'fixture',version:'1.0.0'});
  write('workload/package-lock.json', {name:'fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0'}}});
  git('init'); git('add', '.');
  const commit = () => { git('add','.'); git('-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture'); return git('rev-parse','HEAD'); };
  const revision = commit();
  let trusted = revision;
  const evidence = { version:'1.0',revision,tree_digest:git('rev-parse','HEAD^{tree}'),workload_id:'security-workload',profile:'node-24',contract_digest:hash(JSON.stringify(contract)),tools:{gitleaks:'8.30.1',osv:'2.6.0'},secrets:{status:'clean',exit_code:0,findings:[]},dependencies:{status:'clean',exit_code:0,findings:[]} };
  const run = (command='security', extra=[]) => {
    write('evidence.json', evidence);
    const result = spawnSync(process.execPath,[cli,command,'--trusted-revision',trusted,'--trusted-repo',repo,'--contract',join(repo,'factory-contract.yaml'),...(command === 'security' ? ['--evidence',join(repo,'evidence.json')] : []),...extra],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:''}});
    return {...result,report:result.stdout ? JSON.parse(result.stdout) : null};
  };
  return {repo,git,write,commit,revision,evidence,run,setTrusted:value=>{trusted=value;}};
}

test('clean revision-bound security scans pass both mandatory gates', t => {
  const f=fixture(t), result=f.run();
  assert.equal(result.status,0,result.stderr || result.stdout);
  assert.deepEqual(result.report.results.map(gate=>gate.status),['passed','passed']);
  assert.equal(result.report.revision,f.revision);
});

test('dependency severity boundary allows low and denies medium, high, and critical', t => {
  const f=fixture(t);
  f.evidence.dependencies={status:'findings',exit_code:1,findings:[{package:'fixture',severity:'low',advisory:'GHSA-fixture-only'}]};
  assert.equal(f.run().status,0);
  for (const severity of ['medium','high','critical']) {
    f.evidence.dependencies.findings[0].severity=severity;
    const result=f.run(); assert.equal(result.status,1); assert.equal(result.report.results[1].status,'failed');
  }
});

test('scanner errors, unsupported results, stale revisions, and malformed evidence cannot pass', t => {
  const f=fixture(t), clean=structuredClone(f.evidence);
  const cases=[
    e=>{e.revision='a'.repeat(40);},e=>{e.tree_digest='b'.repeat(40);},e=>{e.contract_digest='c'.repeat(64);},
    e=>{e.tools.gitleaks='8.0.0';},e=>{e.tools.osv='0.0.0';},e=>{e.secrets.status='error';e.secrets.exit_code=2;},
    e=>{e.dependencies.status='unsupported';e.dependencies.exit_code=null;},e=>{e.dependencies.exit_code=1;},
    e=>{e.secrets.status='findings';e.secrets.exit_code=10;},e=>{e.secrets.secret='must-not-be-logged';}
  ];
  for (const mutate of cases) {
    Object.assign(f.evidence,structuredClone(clean)); mutate(f.evidence);
    const result=f.run(); assert.equal(result.status,1,result.stdout); assert.equal(result.report.outcome,'blocked');
    assert.ok(!result.stdout.includes('must-not-be-logged'));
  }
});

test('a test-file secret needs independent trusted approval for the exact source revision', t => {
  const f=fixture(t), source='fixture dummy value';
  f.write('workload/tests/dummy.txt',source);
  const revision=f.commit();
  f.evidence.revision=revision; f.evidence.tree_digest=f.git('rev-parse','HEAD^{tree}');
  const finding={path:'workload/tests/dummy.txt',rule:'safe-fixture-rule',line:1,source_digest:hash(source)};
  f.evidence.secrets={status:'findings',exit_code:10,findings:[finding]};
  assert.equal(f.run().status,1);
  const ledger=JSON.parse(JSON.stringify({version:'1.0',approvals:[{...finding,revision,workload_id:'security-workload',owner:'workload-owner',approver:'factory-owner',reason:'Synthetic test fixture only',approved_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()}]}));
  const enforcement=JSON.parse(JSON.stringify({version:'1.0',maximum_command_timeout_seconds:300,exception_approvers:['factory-owner'],approvals:[]}));
  f.write('policies/enforcement.yaml',enforcement); f.write('policies/security-dummy-approvals.json',ledger);
  const trusted=f.commit(); f.setTrusted(trusted); f.git('checkout','--detach',revision);
  assert.equal(f.run().status,0);
  f.evidence.secrets.findings[0].source_digest='d'.repeat(64);
  assert.equal(f.run().status,1);
});

test('candidate security policy cannot relax trusted secret or dependency thresholds', t => {
  const f=fixture(t);
  f.write('policies/dependencies.yaml','dependencies:\n  vulnerability_threshold:\n    max_severity_allowed: critical\n');
  const head=f.commit(); f.evidence.revision=head; f.evidence.tree_digest=f.git('rev-parse','HEAD^{tree}');
  f.evidence.dependencies={status:'findings',exit_code:1,findings:[{package:'fixture',severity:'high',advisory:'GHSA-fixture-only'}]};
  assert.equal(f.run().status,1);
});

test('missing security evidence blocks delivery through the public validation interface', () => {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const result = spawnSync(process.execPath, [cli, 'security', '--trusted-revision', revision, '--evidence', 'missing-security-evidence.json'], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, 'blocked');
  assert.ok(report.results.every(gate => gate.status !== 'passed'));
});

test('pinned scanners scan committed snapshots and deny a generated dummy credential', {skip:process.env.FACTORY_SECURITY_INTEGRATION !== '1'}, t => {
  const f=fixture(t);
  f.write('workload/package-lock.json',readFileSync(join(root,'examples/reference-workload/package-lock.json'),'utf8'));
  f.write('workload/package.json',readFileSync(join(root,'examples/reference-workload/package.json'),'utf8'));
  f.commit();
  const extra=['--tools-dir',join(root,'tmp/security-tools/installed')];
  const clean=f.run('scan-security',extra);
  assert.equal(clean.status,0,clean.stderr || clean.stdout);
  // A synthetic format-compatible fixture, assembled at runtime; never an issued credential.
  const dummy=['gh','p_', '7hfJ3K9mz2Qx8Yc4Nb6Vs1Ta5Wd0Ep9Lu3Rx'].join('');
  f.write('workload/tests/dummy.txt',`token = "${dummy}"\n`); f.commit();
  const denied=f.run('scan-security',extra);
  assert.equal(denied.status,1,denied.stdout);
  assert.equal(denied.report.results[0].status,'failed');
  assert.ok(!denied.stdout.includes(dummy));
  // Candidate suppression configuration and comments cannot hide the credential.
  f.write('.gitleaksignore','*'); f.write('.gitleaks.toml','[allowlist]\npaths = [".*"]\n'); f.commit();
  assert.equal(f.run('scan-security',extra).report.results[0].status,'failed');
  f.write('workload/package.json',{name:'fixture',version:'1.0.0',dependencies:{lodash:'4.17.11'}}); f.commit();
  assert.equal(f.run('scan-security',extra).report.results[1].status,'error');
});

test('pinned dependency scanner denies a known vulnerable locked package', {skip:process.env.FACTORY_SECURITY_INTEGRATION !== '1'}, t => {
  const f=fixture(t);
  f.write('workload/package.json',{name:'fixture',version:'1.0.0',dependencies:{lodash:'4.17.11'}});
  f.write('workload/package-lock.json',{name:'fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0',dependencies:{lodash:'4.17.11'}},'node_modules/lodash':{version:'4.17.11',resolved:'https://registry.npmjs.org/lodash/-/lodash-4.17.11.tgz'}}});
  f.commit();
  const result=f.run('scan-security',['--tools-dir',join(root,'tmp/security-tools/installed')]);
  assert.equal(result.status,1,result.stdout);
  assert.equal(result.report.results[1].status,'failed');
  assert.ok(result.report.findings.dependencies.some(finding=>finding.package === 'lodash'));
});
