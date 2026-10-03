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
  ['factory-security.yml', 'security-plane', 'secret-scanning', true],
  ['factory-agent-review.yml', 'code-quality-and-policy-review', 'policy-review', true],
  ['factory-release.yml', 'release-plane', 'release-certification', true],
  ['factory-dependencies.yml', 'evaluate-dependencies', 'dependency-automation', false],
  ['factory-health.yml', 'evaluate-health', 'health-monitoring', false],
  ['factory-remediation.yml', 'auto-remediate', 'agent-remediation', false],
];

test('workflow fixtures cannot approve, mutate, publish, or hide unsupported required gates', () => {
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
          assert.ok(/^(node scripts\/factory-validation\.mjs (inventory|certify|capability [a-z-]+(?: --required)?)|npm (ci --ignore-scripts|run typecheck|test))$/.test(step.run.trim()), filename);
          assert.equal(step.if, undefined, filename);
        }
      }
    }
  }
});

for (const [filename, jobName, capability, required] of fixtures) {
  test(`${filename} reports unsupported and ${required ? 'blocks the required gate' : 'leaves optional automation disabled'}`, () => {
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
      assert.equal(outcome.status, required ? 1 : 0);
      const report = JSON.parse(outcome.stdout);
      assert.equal(report.outcome, required ? 'blocked' : 'unsupported');
      assert.ok(report.results.some((gate) => gate.capability === capability && gate.required === required && gate.status === 'unsupported'));
      assert.match(readFileSync(summary, 'utf8'), /not evidence of a clean workload check or permission to act/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
