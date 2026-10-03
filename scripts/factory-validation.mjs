import { appendFileSync } from 'node:fs';

// Public readiness interface. Workload execution and policy evaluation follow in #3/#4.
/** @type {Record<string, { reason: string, trackingIssue: number, requiredForRelease: boolean }>} */
const capabilities = {
  'contract-validation': {
    reason: 'Contract execution and a runnable reference workload are not implemented.',
    trackingIssue: 3,
    requiredForRelease: true,
  },
  'policy-review': {
    reason: 'Trusted policy evaluation and required human approval checks are not implemented.',
    trackingIssue: 4,
    requiredForRelease: true,
  },
  coverage: {
    reason: 'Global and changed-code coverage thresholds are not enforced.',
    trackingIssue: 5,
    requiredForRelease: true,
  },
  'secret-scanning': {
    reason: 'No secret scanner is configured; source code has not been checked for secrets.',
    trackingIssue: 6,
    requiredForRelease: true,
  },
  'dependency-scanning': {
    reason: 'Dependency findings are not evaluated against Security policy.',
    trackingIssue: 6,
    requiredForRelease: true,
  },
  'sast-policy': {
    reason: 'CodeQL findings are not enforced against configured severity thresholds.',
    trackingIssue: 7,
    requiredForRelease: true,
  },
  'release-certification': {
    reason: 'Exact-revision validation, approval, and artifact evidence are not verified.',
    trackingIssue: 14,
    requiredForRelease: true,
  },
  'agent-remediation': {
    reason: 'Agent writes and fix PR creation are disabled until authorization and bounded execution exist.',
    trackingIssue: 11,
    requiredForRelease: false,
  },
  'dependency-automation': {
    reason: 'Dependency updates, automatic approvals, and merges are disabled until policy gates exist.',
    trackingIssue: 12,
    requiredForRelease: false,
  },
  'health-monitoring': {
    reason: 'Endpoint checks, incident alerts, and rollback are disabled; no workload health is measured.',
    trackingIssue: 17,
    requiredForRelease: false,
  },
  'release-publication': {
    reason: 'Versioning, release publication, and deployment are disabled pending verified certification.',
    trackingIssue: 15,
    requiredForRelease: false,
  },
};

const args = process.argv.slice(2);
const [command, capability, requiredFlag] = args;

/** @param {{ operation: string, outcome: string, results: Array<{ capability: string, status: string, required: boolean, reason: string, trackingIssue: number }> }} report */
function publish(report) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = report.results.map((gate) =>
      `| ${gate.capability} | ${gate.status} | ${gate.required ? 'yes' : 'no'} | ${gate.reason} (#${gate.trackingIssue}) |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `## Factory ${report.operation}: ${report.outcome}`,
      '',
      'This is a capability report, not evidence of a clean workload check or permission to act.',
      '',
      '| Capability | Status | Required for this request | Reason / tracking issue |',
      '| --- | --- | --- | --- |',
      ...rows,
      '',
    ].join('\n') + '\n');
  }
  console.log(JSON.stringify({ schemaVersion: 1, ...report }));
}

if (command === 'inventory' && args.length === 1) {
  publish({ operation: 'inventory', outcome: 'unsupported', results: Object.entries(capabilities)
    .map(([name, entry]) => ({ capability: name, status: 'unsupported', required: entry.requiredForRelease, ...entry })) });
} else if (command === 'certify' && args.length === 1) {
  const results = Object.entries(capabilities)
    .filter(([, entry]) => entry.requiredForRelease)
    .map(([name, entry]) => ({ capability: name, status: 'unsupported', required: true, ...entry }));
  publish({ operation: 'certify', outcome: 'blocked', results });
  process.exitCode = 1;
} else if (command === 'capability' && Object.hasOwn(capabilities, capability ?? '') &&
  (args.length === 2 || (args.length === 3 && requiredFlag === '--required'))) {
  const required = requiredFlag === '--required';
  publish({
    operation: 'capability',
    outcome: required ? 'blocked' : 'unsupported',
    results: [{ capability, status: 'unsupported', required, ...capabilities[capability] }],
  });
  process.exitCode = required ? 1 : 0;
} else {
  console.error('Usage: factory-validation.mjs inventory | capability <name> [--required] | certify');
  process.exitCode = 2;
}
