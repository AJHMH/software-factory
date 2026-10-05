import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Controlled demonstration evidence is separate from live readiness. */
export function inspectReadiness() {
  return {
    operation: 'readiness', outcome: 'not-run', readiness: 'incomplete', evidenceAssessmentDate: '2026-10-04',
    results: scenarios.map(scenario => ({ ...scenario, status: 'not-run', required: true,
      reason: 'Controlled public-interface scenarios; no hosted authorization or production certification implied.' })),
    gaps: [
      { capability: 'consumer-certification', issue: 49, reason: 'Successful certification of the second consumer remains unverified.' },
      { capability: 'scheduled-governance', issue: 31, reason: 'Scoped ruleset read credential remains an operator prerequisite.' },
      { capability: 'certified-publication', reason: 'No live signed release publication evidence recorded.' },
      { capability: 'hosted-promotion', reason: 'No live deployment and protected Environment approval evidence recorded.' },
      { capability: 'hosted-retention', reason: 'Configured delivery artifact retention has not been verified at the live expiry boundary.' },
      { capability: 'runtime-recovery', reason: 'Only reference package restoration is supported; running service recovery is unsupported.' },
    ],
  };
}

export function demonstrateReadiness() {
  const report = inspectReadiness();
  const root = fileURLToPath(new URL('../', import.meta.url));
  // Never forward operator API credentials, signing secrets, preloads, or Actions output paths.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(name)));
  const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, env: environment, encoding: 'utf8', timeout: 10000 });
  const state = spawnSync('git', ['status', '--porcelain'], { cwd: root, env: environment, encoding: 'utf8', timeout: 10000 });
  const sourceRevision = source.status === 0 && /^[a-f0-9]{40}$/.test(source.stdout.trim()) ? source.stdout.trim() : null;
  const workingTreeDirty = state.status !== 0 || state.stdout.trim().length > 0;
  const startedAt = new Date().toISOString();
  const results = report.results.map(scenario => {
    const execution = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
      ...(scenario.testNamePattern ? ['--test-name-pattern', scenario.testNamePattern] : []), scenario.file], {
      cwd: root, env: environment, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
    });
    const output = execution.stdout ?? '';
    const count = (/** @type {string} */ name) => Number(output.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? 0);
    const testsPassed = count('pass'), testsSkipped = count('skipped');
    const passed = !execution.error && execution.status === 0 && testsPassed > 0 && count('fail') === 0 && count('cancelled') === 0;
    return { ...scenario, status: passed ? 'passed' : 'failed', evidenceKind: 'controlled-test',
      testsPassed, testsSkipped, testsFailed: count('fail'),
      outputDigest: createHash('sha256').update(output).digest('hex'),
      reason: passed ? 'Controlled public-interface scenarios passed. API responses and release certificates may be fixtures; skipped integrations are not evidence.' :
        'Scenario execution failed, timed out, or lacked a complete passing test summary. Run the named test file locally for diagnostics.',
    };
  });
  return { ...report, sourceRevision, workingTreeDirty, startedAt, completedAt: new Date().toISOString(),
    outcome: results.every(result => result.status === 'passed') ? 'passed' : 'blocked', results };
}

/** @type {Array<{capability: string, file: string, testNamePattern?: string}>} */
const scenarios = [
  { capability: 'reference-and-consumer', file: 'tests/factory-distribution.test.mjs' },
  { capability: 'weakened-policy', file: 'tests/policy-evaluation.test.mjs' },
  { capability: 'missing-review-and-stale-evidence', file: 'tests/human-review.test.mjs' },
  { capability: 'vulnerability-denial', file: 'tests/security.test.mjs' },
  { capability: 'bounded-remediation-and-unauthorized-requests', file: 'tests/remediation.test.mjs' },
  { capability: 'redaction-and-retention', file: 'tests/agent-runner.test.mjs' },
  { capability: 'delivery-evidence-redaction', file: 'tests/readiness.test.mjs', testNamePattern: 'delivery evidence' },
  { capability: 'governed-dependencies', file: 'tests/dependencies.test.mjs' },
  { capability: 'certified-release-preparation', file: 'tests/release-management.test.mjs' },
  { capability: 'reference-promotion', file: 'tests/artifact-promotion.test.mjs' },
  { capability: 'monitoring', file: 'tests/health-monitoring.test.mjs' },
  { capability: 'reference-rollback', file: 'tests/artifact-rollback.test.mjs' },
];
