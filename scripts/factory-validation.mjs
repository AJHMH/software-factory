import { appendFileSync } from 'node:fs';

// Execution and scoped policy evaluation are available; hosted authorization and release evidence follow later.
/** @type {Record<string, { reason: string, trackingIssue: number, requiredForRelease: boolean, available?: boolean }>} */
const capabilities = {
  'bounded-agent-proposal': {
    reason: 'The fixed-cost fixture adapter can propose bounded changes via propose-change; this report supplies no executed or audited proposal evidence.',
    trackingIssue: 10,
    requiredForRelease: false,
    available: true,
  },
  'repository-governance': {
    reason: 'Protection bootstrap and drift inspection are available via bootstrap-governance and collect-governance; this report supplies no live configuration evidence.',
    trackingIssue: 9,
    requiredForRelease: true,
    available: true,
  },
  'contract-validation': {
    reason: 'Contract execution is available via validate; this report supplies no executed gate evidence.',
    trackingIssue: 3,
    requiredForRelease: true,
    available: true,
  },
  'policy-review': {
    reason: 'Trusted execution-policy evaluation is available via policy; this report supplies no evaluated policy or hosted human-review evidence.',
    trackingIssue: 4,
    requiredForRelease: true,
    available: true,
  },
  coverage: {
    reason: 'Coverage evaluation is available via coverage and measure-coverage; this report supplies no measured evidence.',
    available: true,
    trackingIssue: 5,
    requiredForRelease: true,
  },
  'secret-scanning': {
    reason: 'Pinned secret scanning is available via scan-security; this report supplies no executed scan evidence.',
    available: true,
    trackingIssue: 6,
    requiredForRelease: true,
  },
  'dependency-scanning': {
    reason: 'Pinned dependency scanning is available via scan-security; this report supplies no executed scan evidence.',
    available: true,
    trackingIssue: 6,
    requiredForRelease: true,
  },
  'sast-policy': {
    reason: 'Native CodeQL severity evaluation is available via sast and collect-sast; this report supplies no evaluated analysis evidence.',
    available: true,
    trackingIssue: 7,
    requiredForRelease: true,
  },
  'human-review': {
    reason: 'Human approval evaluation is available via human-review and collect-reviews; this report supplies no current approval evidence.',
    available: true,
    trackingIssue: 8,
    requiredForRelease: true,
  },
  'release-certification': {
    reason: 'Exact-revision validation, approval, and artifact evidence are not verified.',
    trackingIssue: 14,
    requiredForRelease: true,
  },
  'agent-remediation': {
    reason: 'Authorized bounded JSON formatting remediation is available via remediate; hosted publication requires protected credentials and explicit activation. This report supplies no executed request evidence.',
    available: true,
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

/** @param {{ operation: string, outcome: string, results: Array<{ capability: string, status: string, required: boolean, reason: string, trackingIssue?: number }> }} report */
function publish(report) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = report.results.map((gate) =>
      `| ${gate.capability} | ${gate.status} | ${gate.required ? 'yes' : 'no'} | ${gate.reason.replace(/[|\r\n<>]/g, ' ')}${gate.trackingIssue ? ` (#${gate.trackingIssue})` : ''} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `## Factory ${report.operation}: ${report.outcome}`,
      '',
      report.operation === 'validate' ? 'These command results do not authorize a release or establish policy/security compliance.' :
        report.operation === 'human-review' ? 'Approval evidence applies only to the named PR head and base; it does not authorize a release.' :
        report.operation === 'sast' ? 'CodeQL policy evidence applies only to the named revision; it does not authorize a release.' :
        report.operation === 'security' ? 'Redacted scanner evidence applies only to the named revision; it does not authorize a release.' :
        report.operation === 'coverage' ? 'Coverage and test evidence applies only to the named source revisions; it does not authorize a merge or release.' :
        report.operation === 'policy' ? 'Execution-policy evaluation only: no workload commands executed, hosted human approval verified, or release authorized.' :
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

if (command === 'remediate' && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--trusted-repo','--trusted-revision','--repository-path','--repository','--state-dir','--mode'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=await (await import('./remediation.mjs')).remediate(options);publish(report);process.exitCode=report.outcome === 'passed'?0:1;
} else if (['propose-change','prune-agent-evidence'].includes(command) && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--trusted-repo','--trusted-revision','--repository-path','--proposal','--state-dir','--scope-id','--actor','--cancel-file'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const runner=await import('./agent-runner.mjs');const report=command === 'propose-change'?await runner.proposeChange(options):runner.pruneAgentEvidence(options);publish(report);process.exitCode=report.outcome === 'passed'?0:1;
} else if (['governance','collect-governance','bootstrap-governance'].includes(command) && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--trusted-revision','--trusted-repo','--repository',...(command === 'governance'?['--evidence']:command === 'bootstrap-governance'?['--apply']:[])].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const governance=await import('./governance.mjs');
  const report=command === 'governance'?governance.evaluateGovernance(options):command === 'bootstrap-governance' && options['--apply'] !== 'true'?{operation:'governance',outcome:'blocked',results:[{capability:'repository-governance',required:true,status:'error',reason:'Bootstrap requires explicit --apply true.'}]}:await governance.collectGovernance(options);
  publish(report);process.exitCode=report.outcome === 'passed'?0:1;
} else if (['human-review', 'collect-reviews', 'policy', 'coverage', 'measure-coverage', 'security', 'scan-security', 'sast', 'collect-sast'].includes(command) && args.length >= 3 && args.length % 2 === 1 &&
  args.slice(1).every((arg, index) => index % 2 === 1 || ['--contract', '--trusted-repo', '--trusted-revision', ...(['human-review','collect-reviews'].includes(command) ? ['--base-revision','--repository','--pull-request','--coverage-evidence', ...(command === 'human-review' ? ['--evidence'] : ['--output'])] : ['security','sast'].includes(command) ? ['--evidence'] : command === 'collect-sast' ? ['--repository','--ref','--output'] : command === 'scan-security' ? ['--tools-dir', '--output'] : ['--overrides', ...(command === 'coverage' ? ['--evidence', '--base-revision'] : command === 'measure-coverage' ? ['--base-revision', '--output'] : [])])].includes(arg)) &&
  new Set(args.filter((_, index) => index % 2 === 1)).size === (args.length - 1) / 2) {
  const { evaluatePolicy } = await import('./policy-evaluation.mjs');
  const options = Object.fromEntries(args.slice(1).reduce((entries, value, index, array) => {
    if (index % 2 === 0) entries.push([value, array[index + 1]]);
    return entries;
  }, /** @type {string[][]} */ ([])));
  const report = command === 'collect-reviews' ? await (await import('./review-collection.mjs')).collectReviews(options) : command === 'human-review' ? (await import('./human-review.mjs')).evaluateHumanReview(options) : command === 'collect-sast' ? await (await import('./sast-collection.mjs')).collectSast(options) : command === 'sast' ? (await import('./sast-evaluation.mjs')).evaluateSast(options) : command === 'scan-security' ? await (await import('./security-collection.mjs')).collectSecurity(options) : command === 'security' ? (await import('./security-evaluation.mjs')).evaluateSecurity(options) : command === 'measure-coverage' ? await (await import('./coverage-collection.mjs')).collectCoverage(options) : command === 'coverage' ? (await import('./coverage-evaluation.mjs')).evaluateCoverage(options) : evaluatePolicy(options);
  publish(report);
  process.exitCode = report.outcome === 'passed' ? 0 : 1;
} else if ((command === 'validate' || command === 'profile') &&
  (args.length === 1 || (args.length === 3 && args[1] === '--contract' && args[2]))) {
  const { runContract } = await import('./contract-execution.mjs');
  const report = await runContract(args[2] ?? 'factory-contract.yaml', command === 'profile');
  publish(report);
  if (command === 'profile' && report.outcome === 'passed' && process.env.GITHUB_OUTPUT && 'profile' in report) {
    appendFileSync(process.env.GITHUB_OUTPUT, `node_version=${report.profile.nodeVersion}\n`);
  }
  process.exitCode = report.outcome === 'passed' ? 0 : 1;
} else if (command === 'inventory' && args.length === 1) {
  publish({ operation: 'inventory', outcome: 'unsupported', results: Object.entries(capabilities)
    .map(([name, entry]) => ({ capability: name, status: entry.available ? 'available' : 'unsupported', required: entry.requiredForRelease, ...entry })) });
} else if (command === 'certify' && args.length === 1) {
  const results = Object.entries(capabilities)
    .filter(([, entry]) => entry.requiredForRelease)
    .map(([name, entry]) => ({ capability: name, status: entry.available ? 'not-run' : 'unsupported', required: true, ...entry }));
  publish({ operation: 'certify', outcome: 'blocked', results });
  process.exitCode = 1;
} else if (command === 'capability' && Object.hasOwn(capabilities, capability ?? '') &&
  (args.length === 2 || (args.length === 3 && requiredFlag === '--required'))) {
  const required = requiredFlag === '--required';
  publish({
    operation: 'capability',
    outcome: required ? 'blocked' : capabilities[capability].available ? 'not-run' : 'unsupported',
    results: [{ capability, status: capabilities[capability].available ? 'not-run' : 'unsupported', required, ...capabilities[capability] }],
  });
  process.exitCode = required ? 1 : 0;
} else {
  console.error('Usage: factory-validation.mjs remediate --mode <authorize|prepare|publish> --repository <owner/repo> --trusted-revision <SHA> --repository-path <path> --state-dir <external-dir> | propose-change --trusted-revision <SHA> --repository-path <path> --proposal <file> --state-dir <external-dir> --scope-id <id> --actor <identity> | prune-agent-evidence --trusted-revision <SHA> --state-dir <external-dir> | governance --repository <owner/repo> --trusted-revision <SHA> --evidence <file> | collect-governance --repository <owner/repo> --trusted-revision <SHA> | bootstrap-governance --repository <owner/repo> --trusted-revision <SHA> --apply true | human-review --trusted-revision <SHA> --base-revision <SHA> --repository <owner/repo> --pull-request <number> --evidence <file> [--coverage-evidence <file>] | collect-reviews --trusted-revision <SHA> --base-revision <SHA> --repository <owner/repo> --pull-request <number> [--coverage-evidence github] [--output <file>] | inventory | capability <name> [--required] | certify | validate [--contract <path>] | profile [--contract <path>] | sast --trusted-revision <SHA> --evidence <file> | collect-sast --trusted-revision <SHA> --repository <owner/repo> --ref <exact-ref> [--output <file>] | scan-security --trusted-revision <SHA> [--tools-dir <path>] [--output <file>] | security --trusted-revision <SHA> --evidence <file> | measure-coverage --trusted-revision <SHA> --base-revision <SHA> [--output <file>] | coverage --trusted-revision <SHA> --base-revision <SHA> --evidence <file> | policy --trusted-revision <SHA> [--trusted-repo <path>] [--contract <path>] [--overrides <path>]');
  process.exitCode = 2;
}
