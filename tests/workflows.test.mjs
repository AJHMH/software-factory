import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = [
  ['factory-ci.yml', 'validation-plane', 'contract-validation', true],
  ['factory-release.yml', 'release-plane', 'release-certification', true],
  ['factory-dependencies.yml', 'evaluate-dependencies', 'dependency-automation', false],
  ['factory-health.yml', 'evaluate-health', 'health-monitoring', false],
];

test('workflow fixtures cannot approve, push, publish, or hide unsupported required gates', () => {
  for (const [filename] of fixtures) {
    const workflow = parse(readFileSync(join(root, '.github/workflows', filename), 'utf8'));
    assert.deepEqual(workflow.permissions, { contents: 'read' }, filename);
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(job.permissions, undefined, filename);
      assert.equal(job['continue-on-error'], undefined, filename);
      for (const step of job.steps) {
        assert.equal(step['continue-on-error'], undefined, filename);
        if (step.uses) {
          assert.ok(['actions/checkout@v4', 'actions/setup-node@v4'].includes(step.uses), filename);
          if (step.uses === 'actions/checkout@v4') assert.equal(step.with['persist-credentials'], false, filename);
        } else {
          assert.ok(/^(node scripts\/factory-validation\.mjs (inventory|profile|validate|certify|capability [a-z-]+(?: --required)?)|node scripts\/install-security-tools\.mjs|npm (ci --ignore-scripts|run typecheck|test))$/.test(step.run.trim()), filename);
          assert.equal(step.if, undefined, filename);
        }
      }
    }
  }
});

test('security CI scans the exact head with base policy and no write credentials', () => {
  const workflow=parse(readFileSync(join(root,'.github/workflows/factory-security.yml'),'utf8'));
  assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.ok(!Object.hasOwn(workflow.on,'pull_request_target'));
  const job=workflow.jobs['security-plane'];
  assert.equal(job['continue-on-error'],undefined);
  assert.equal(job.steps[0].with.ref,'${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(job.steps[0].with['fetch-depth'],0);
  assert.equal(job.steps[0].with['persist-credentials'],false);
  assert.equal(job.steps.at(-1).env.TRUSTED_POLICY_REVISION,'${{ github.event.pull_request.base.sha || github.event.before || github.sha }}');
  assert.equal(job.steps.at(-1).run,'node scripts/factory-validation.mjs scan-security --trusted-revision "$TRUSTED_POLICY_REVISION" --output tmp/security-evidence.json');
  assert.ok(job.steps.every(step=>!step.if && !step['continue-on-error'] && !step.run?.includes('${{')));
  const ci=parse(readFileSync(join(root,'.github/workflows/factory-ci.yml'),'utf8'));
  assert.equal(ci.jobs['factory-template-tests'].steps.at(-1).env.FACTORY_SECURITY_INTEGRATION,'1');
});

test('SAST CI evaluates exact-head native analyses with read-only security permissions',()=>{
  const workflow=parse(readFileSync(join(root,'.github/workflows/factory-sast.yml'),'utf8'));
  assert.deepEqual(workflow.permissions,{contents:'read','security-events':'read'});
  assert.ok(!Object.hasOwn(workflow.on,'pull_request_target'));
  const job=workflow.jobs.sast;
  assert.equal(job['timeout-minutes'],8);
  assert.equal(job.steps[0].with.ref,'${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(job.steps[0].with['persist-credentials'],false);
  assert.equal(job.steps.at(-1).env.TRUSTED_POLICY_REVISION,'${{ github.event.pull_request.base.sha || github.event.before }}');
  assert.equal(job.steps.at(-1).env.SOURCE_REF,"${{ github.event.pull_request.number && format('refs/pull/{0}/head', github.event.pull_request.number) || github.ref }}");
  assert.ok(job.steps.every(step=>!step.if && !step['continue-on-error'] && !step.run?.includes('${{')));
  assert.ok(job.steps.at(-1).run.includes('collect-sast'));
});

test('the trusted policy workflow never runs candidate code or uses candidate policy authority', () => {
  const workflow = parse(readFileSync(join(root, '.github/workflows/factory-policy.yml'), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['pull_request_target']);
  assert.deepEqual(workflow.permissions, { contents: 'read', 'pull-requests': 'read', actions: 'read' });
  const job = workflow.jobs['trusted-policy'];
  assert.equal(job['timeout-minutes'], 5);
  assert.equal(job.permissions, undefined);
  assert.equal(job['continue-on-error'], undefined);
  const checkouts = job.steps.filter(step => step.uses === 'actions/checkout@v4');
  assert.equal(checkouts.length, 2);
  assert.equal(checkouts[0].with.ref, '${{ github.event.pull_request.base.sha }}');
  assert.equal(checkouts[0].with.path, 'trusted');
  assert.equal(checkouts[1].with.ref, '${{ github.event.pull_request.head.sha }}');
  assert.equal(checkouts[1].with.repository, '${{ github.event.pull_request.head.repo.full_name }}');
  assert.equal(checkouts[1].with.path, 'candidate');
  assert.ok(checkouts.every(step => step.with['persist-credentials'] === false));
  const runs = job.steps.filter(step => step.run);
  assert.deepEqual(runs.map(step => step['working-directory']), ['trusted', 'trusted']);
  assert.equal(runs[0].run, 'npm ci --ignore-scripts');
  assert.equal(runs[1].env.TRUSTED_POLICY_REVISION, '${{ github.event.pull_request.base.sha }}');
  assert.equal(runs[1].run, 'node scripts/factory-validation.mjs policy --trusted-revision "$TRUSTED_POLICY_REVISION" --contract ../candidate/factory-contract.yaml --overrides ../candidate/policy-exceptions.yaml');
  assert.ok(job.steps.every(step => !step['continue-on-error'] && !step.if && !step.run?.includes('${{')));
});

test('coverage CI binds the candidate, baseline, and governing policy to GitHub revision metadata', () => {
  const workflow = parse(readFileSync(join(root, '.github/workflows/factory-coverage.yml'), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs.coverage;
  assert.equal(job['timeout-minutes'], 10);
  assert.equal(job.permissions, undefined);
  const checkout = job.steps[0];
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.equal(checkout.with['persist-credentials'], false);
  const gate = job.steps.at(-2);
  assert.equal(gate.env.BASE_REVISION, '${{ github.event.pull_request.base.sha || github.event.before }}');
  assert.equal(gate.env.TRUSTED_POLICY_REVISION, '${{ github.event.pull_request.base.sha || github.event.before }}');
  assert.equal(gate.run, 'node scripts/factory-validation.mjs measure-coverage --base-revision "$BASE_REVISION" --trusted-revision "$TRUSTED_POLICY_REVISION" --output coverage/evidence.json');
  assert.ok(job.steps.every(step => !step['continue-on-error'] && !step.run?.includes('${{')));
  const artifact=job.steps.at(-1);assert.equal(artifact.uses,'actions/upload-artifact@v4');assert.equal(artifact.with.path,'coverage/evidence.json');assert.equal(artifact.with['if-no-files-found'],'error');assert.equal(artifact.with['retention-days'],7);
});

test('human review re-evaluates current PR heads on reviews and dismissals without write permissions',()=>{
  const workflow=parse(readFileSync(join(root,'.github/workflows/factory-agent-review.yml'),'utf8'));
  assert.deepEqual(workflow.permissions,{contents:'read','pull-requests':'read',actions:'read'});
  assert.deepEqual(workflow.on.pull_request_review.types,['submitted','edited','dismissed']);
  assert.ok(workflow.on.pull_request.types.includes('synchronize'));
  assert.equal(workflow.concurrency['cancel-in-progress'],true);
  assert.ok(!Object.hasOwn(workflow.on,'pull_request_target'));
  const job=workflow.jobs['human-review'];assert.equal(job['continue-on-error'],undefined);
  assert.equal(job.steps[0].with.ref,'${{ github.event.pull_request.head.sha }}');
  assert.equal(job.steps[0].with['persist-credentials'],false);
  const gate=job.steps.at(-1);assert.equal(gate.env.BASE_REVISION,'${{ github.event.pull_request.base.sha }}');
  assert.equal(gate.env.TRUSTED_POLICY_REVISION,'${{ vars.FACTORY_REVIEW_POLICY_REVISION || github.event.pull_request.base.sha }}');
  assert.ok(gate.run.includes('--trusted-revision "$TRUSTED_POLICY_REVISION"'));
  assert.ok(gate.run.includes('collect-reviews'));assert.ok(gate.run.includes('--coverage-evidence github'));
  assert.ok(job.steps.every(step=>!step['continue-on-error'] && !step.run?.includes('${{')));
});

for (const [filename, jobName, capability, required] of fixtures) {
  test(`${filename} ${filename === 'factory-ci.yml' ? 'executes the reference workload' : required ? 'blocks unsupported required gates' : 'reports optional automation disabled'}`, () => {
    const workflow = parse(readFileSync(join(root, '.github/workflows', filename), 'utf8'));
    const job = workflow.jobs[jobName];
    assert.equal(job.if, undefined, 'A supported event must not silently skip reporting');
    if (filename === 'factory-remediation.yml') {
      assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    }
    const directory = mkdtempSync(join(tmpdir(), 'factory-workflow-'));
    const summary = join(directory, 'summary.md');
    try {
      const outcomes = [];
      for (const step of job.steps.filter((entry) => entry.run)) {
        if (step.run === 'npm ci --ignore-scripts') continue; // Tool installation is exercised by CI; the fixture host already installed them.
        const [runtime, script, ...args] = step.run.trim().split(/\s+/);
        assert.equal(runtime, 'node');
        const result = spawnSync(process.execPath, [join(root, script), ...args], {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
        });
        assert.equal(result.stderr, '');
        outcomes.push(result);
        if (result.status !== 0) break;
      }
      assert.ok(outcomes.length > 0, 'Workflow must actually invoke a gate');
      const outcome = outcomes.at(-1);
      const executesContract = filename === 'factory-ci.yml';
      assert.equal(outcome.status, required && !executesContract ? 1 : 0);
      const report = JSON.parse(outcome.stdout);
      assert.equal(report.outcome, executesContract ? 'passed' : required ? 'blocked' : capability === 'policy-review' ? 'not-run' : 'unsupported');
      if (executesContract) {
        assert.equal(report.operation, 'validate');
        assert.deepEqual(report.results.map((gate) => gate.capability), ['install', 'validate', 'test', 'build']);
        assert.ok(report.results.every((gate) => gate.status === 'passed'));
        const runtimeStep = job.steps.find((step) => step.name === 'Set up selected workload runtime');
        assert.equal(runtimeStep.with['node-version'], '${{ steps.profile.outputs.node_version }}');
      } else {
        assert.ok(report.results.some((gate) => gate.capability === capability && gate.required === required && gate.status === (capability === 'policy-review' ? 'not-run' : 'unsupported')));
      }
      assert.match(readFileSync(summary, 'utf8'), /not evidence of a clean workload check or permission to act/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}


test('hosted remediation authorizes requests with no publisher, secret, or write permission',()=>{
 const workflow=parse(readFileSync(join(root,'.github/workflows/factory-remediation.yml'),'utf8'));
 assert.deepEqual(workflow.permissions,{contents:'read','pull-requests':'read'});
 assert.deepEqual(Object.keys(workflow.on),['issue_comment','repository_dispatch','workflow_dispatch']);
 assert.equal(workflow.concurrency['cancel-in-progress'],false);assert.deepEqual(Object.keys(workflow.jobs),['authorize']);
 const auth=workflow.jobs.authorize;assert.equal(auth.permissions,undefined);assert.match(auth.if,/refs\/heads\/main/);assert.equal(auth.environment,undefined);
 for(const step of auth.steps) {assert.equal(step['continue-on-error'],undefined);assert.ok(!step.run?.includes('${{'));if(step.uses==='actions/checkout@v4') assert.equal(step.with['persist-credentials'],false);}
 assert.ok(!JSON.stringify(workflow).includes('secrets.'));assert.ok(auth.steps.at(-1).run.includes('remediate --mode authorize'));
});
