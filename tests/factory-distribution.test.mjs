import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

const root = process.cwd();
const cli = join(root, 'scripts/factory-validation.mjs');
function fixture(t) {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const directory = mkdtempSync(join(root, 'tmp/distribution-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const factory = join(directory, 'factory'), consumer = join(directory, 'consumer');
  mkdirSync(factory); mkdirSync(consumer);
  const git = (repo, ...args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  const commit = repo => { git(repo, 'add', '.'); git(repo, '-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'); return git(repo, 'rev-parse', 'HEAD'); };
  for (const path of ['factory-distribution.yaml', 'profiles/workloads.yaml', ...['enforcement','governance','human-review','quality','security','dependencies'].map(name => `policies/${name}.yaml`)]) {
    mkdirSync(join(factory, path, '..'), { recursive: true }); copyFileSync(join(root, path), join(factory, path));
  }
  const fixtureManifest=parse(readFileSync(join(factory,'factory-distribution.yaml'),'utf8'));fixtureManifest.version='1.0.0';writeFileSync(join(factory,'factory-distribution.yaml'),stringify(fixtureManifest));
  git(factory, 'init'); const revision = commit(factory);
  const lock = { schema_version: 1, factory: { repository: 'AJHMH/software-factory', revision, version: '1.0.0', profile: 'node-24', policy_pack: 'baseline-1' } };
  const contract = { version: '1.0', contract: { workload_id: 'second-workload', profile: 'node-24', working_directory: 'workload', commands: Object.fromEntries(['install','validate','test','build'].map(name => [name, { run: `node step.mjs ${name}`, timeout_seconds: 10 }])) } };
  const workflow = { on: ['push'], jobs: { validation: { uses: `AJHMH/software-factory/.github/workflows/factory-consumer-validation.yml@${revision}` }, certification: { uses: `AJHMH/software-factory/.github/workflows/factory-consumer-certification.yml@${revision}` } } };
  const save = () => {
    writeFileSync(join(consumer, 'factory.lock.yaml'), stringify(lock)); writeFileSync(join(consumer, 'factory-contract.yaml'), stringify(contract));
    writeFileSync(join(consumer, '.github/workflows/factory-adoption.yml'), stringify(workflow));
  };
  mkdirSync(join(consumer, '.github/workflows'), { recursive: true }); mkdirSync(join(consumer, 'workload'));
  writeFileSync(join(consumer, '.gitignore'), 'tmp/\nworkload/dist/\n'); writeFileSync(join(consumer, 'workload/step.mjs'), 'console.log(process.argv[2]);');
  mkdirSync(join(consumer, 'workload/src'));
  writeFileSync(join(consumer, 'workload/src/index.mjs'), 'export const consumer = "second-workload";\n');
  for (const file of ['package.json', 'package-lock.json']) writeFileSync(join(consumer, 'workload', file), readFileSync(join(root, 'examples/consumer-workload', file)));
  git(consumer, 'init'); save(); commit(consumer);
  const options = { '--mode': 'inspect', '--trusted-repo': factory, '--trusted-revision': revision, '--factory-repository': 'AJHMH/software-factory', '--approved-revision': revision, '--consumer-repo': consumer };
  const run = () => { const r = spawnSync(process.execPath, [cli, 'distribution', ...Object.entries(options).flat()], { cwd: root, encoding: 'utf8' }); assert.ok(r.stdout, r.stderr); return { status: r.status, report: JSON.parse(r.stdout) }; };
  return { factory, consumer, revision, lock, contract, workflow, options, save, commit, git, run };
}

test('public distribution interface verifies an immutable consumer adoption without copying pipelines', t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0);
  assert.equal(result.report.outcome, 'passed');
  assert.equal(result.report.factory.version, '1.0.0');
  assert.equal(result.report.factory.revision, f.revision);
  assert.match(result.report.factory.policyDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.report.workloadId, 'second-workload');
  assert.match(result.report.policy.evidenceDigest,/^[a-f0-9]{64}$/);
});

test('consumer validation enforces pinned policy and propagates a failed workload gate', t => {
  const f = fixture(t); f.options['--mode'] = 'validate';
  assert.equal(f.run().report.outcome, 'passed');
  f.contract.contract.commands.test.run = 'node -e "process.exit(7)"';
  f.save(); f.commit(f.consumer);
  const failed = f.run();
  assert.equal(failed.status, 1);
  assert.equal(failed.report.validation.results.at(-1).exitCode, 7);
  assert.equal(failed.report.validation.results.at(-1).capability, 'test');
});

test('consumer mismatches and unapproved upgrades fail before executing workload commands', t => {
  const f = fixture(t);
  const original = structuredClone({ lock: f.lock, contract: f.contract, workflow: f.workflow });
  for (const change of [
    () => { f.lock.factory.version = '2.0.0'; },
    () => { f.lock.factory.profile = 'node-22'; },
    () => { f.lock.factory.policy_pack = 'relaxed'; },
    () => { f.workflow.jobs.validation.uses = 'AJHMH/software-factory/.github/workflows/factory-consumer-validation.yml@main'; },
    () => { f.workflow.jobs.validation.if = 'false'; },
    () => { f.workflow.jobs.validation['continue-on-error'] = '${{ true }}'; },
    () => { f.contract.contract.commands.test.timeout_seconds = 600; },
    () => { f.options['--approved-revision'] = 'b'.repeat(40); },
  ]) {
    Object.assign(f.lock, structuredClone(original.lock)); Object.assign(f.contract, structuredClone(original.contract)); Object.assign(f.workflow, structuredClone(original.workflow));
    f.options['--approved-revision'] = f.revision;
    change(); f.save(); f.commit(f.consumer);
    assert.equal(f.run().report.outcome, 'blocked');
  }
});

test('consumer upgrades require approval and matching pins, and can recover to the previous version', t => {
  const f = fixture(t);
  const manifest = parse(readFileSync(join(f.factory, 'factory-distribution.yaml'), 'utf8'));
  manifest.version = '1.0.1'; writeFileSync(join(f.factory, 'factory-distribution.yaml'), stringify(manifest));
  const upgraded = f.commit(f.factory);
  f.options['--trusted-revision'] = upgraded;
  assert.equal(f.run().report.outcome, 'blocked');
  f.options['--approved-revision'] = upgraded;
  f.lock.factory.revision = upgraded; f.lock.factory.version = '1.0.1';
  for (const job of ['validation','certification']) f.workflow.jobs[job].uses = f.workflow.jobs[job].uses.replace(f.revision, upgraded);
  f.save(); f.commit(f.consumer);
  assert.equal(f.run().report.factory.version, '1.0.1');
  f.git(f.factory, 'checkout', '--detach', f.revision);
  f.options['--trusted-revision'] = f.revision; f.options['--approved-revision'] = f.revision;
  f.lock.factory.revision = f.revision; f.lock.factory.version = '1.0.0';
  for (const job of ['validation','certification']) f.workflow.jobs[job].uses = f.workflow.jobs[job].uses.replace(upgraded, f.revision);
  f.save(); f.commit(f.consumer);
  assert.equal(f.run().report.factory.version, '1.0.0');
});

test('consumer artifacts bind separate source history to pinned Factory policy and verify without rebuilding', t => {
  const f = fixture(t); f.options['--mode'] = 'validate';
  const validation = f.run().report.validation;
  mkdirSync(join(f.consumer, 'tmp')); writeFileSync(join(f.consumer, 'tmp/validation.json'), JSON.stringify(validation));
  mkdirSync(join(f.consumer, 'workload/dist'));
  copyFileSync(join(f.consumer, 'workload/src/index.mjs'), join(f.consumer, 'workload/dist/index.mjs'));
  const run = (mode, extra) => {
    const result = spawnSync(process.execPath, [cli, 'release-artifact', ...Object.entries({ ...f.options, '--mode': mode, ...extra }).flat()], { cwd: root, encoding: 'utf8' });
    assert.ok(result.stdout, result.stderr); return { status: result.status, report: JSON.parse(result.stdout) };
  };
  const output = join(f.consumer, 'tmp/artifact');
  const produced = run('produce', { '--validation-evidence': join(f.consumer, 'tmp/validation.json'), '--output-dir': output });
  assert.equal(produced.status, 0, JSON.stringify(produced));
  rmSync(join(f.consumer, 'workload/dist'), { recursive: true });
  const verified = run('verify', { '--artifact-directory': output });
  assert.equal(verified.status, 0, JSON.stringify(verified));
  assert.equal(verified.report.revision, validation.revision);
  assert.notEqual(verified.report.revision, f.revision);
  assert.equal(verified.report.dependencySource.lockfile, 'workload/package-lock.json');
});

test('consumer governance requires every baseline check under the real reusable validation namespace', t => {
  const f=fixture(t);
  const policy=parse(readFileSync(join(root,'policies/governance.yaml'),'utf8')).governance.repository_protection;
  const checks=policy.required_checks.map(check=>({...check,context:'validation / '+check.context}));
  const snapshot={repository:'owner/consumer',default_branch:'main',rulesets:[{name:'Factory governed default branch',target:'branch',enforcement:'active',bypass_actors:[],conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[...['deletion','non_fast_forward','required_signatures','required_linear_history'].map(type=>({type})),{type:'pull_request',parameters:{required_approving_review_count:1,dismiss_stale_reviews_on_push:true,required_review_thread_resolution:true}},{type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,do_not_enforce_on_create:false,required_status_checks:checks}}]}]};
  const file=join(f.consumer,'tmp/governance.json');mkdirSync(join(f.consumer,'tmp'));writeFileSync(file,JSON.stringify(snapshot));
  const run=()=>spawnSync(process.execPath,[cli,'governance','--repository','owner/consumer','--evidence',file,...Object.entries(f.options).filter(([key])=>key !== '--mode').flat()],{encoding:'utf8'});
  const passed=run();assert.equal(passed.status,0,passed.stdout+passed.stderr);
  checks.pop();writeFileSync(file,JSON.stringify(snapshot));assert.equal(run().status,1,'all baseline checks remain mandatory');
});
