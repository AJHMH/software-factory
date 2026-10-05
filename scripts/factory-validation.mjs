import { appendFileSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Factory validation, hosted authorization, releases, and controlled reference promotion share this public interface.
/** @type {Record<string, { reason: string, trackingIssue: number, requiredForRelease: boolean, available?: boolean }>} */
const capabilities = {
  'versioned-factory-distribution': {
    reason: 'distribution verifies immutable consumer calls, compatibility, approved policy selection, and executes consumer gates; this inventory supplies no hosted adoption or certification evidence.',
    trackingIssue: 19,
    requiredForRelease: false,
    available: true,
  },
  'bounded-agent-proposal': {
    reason: 'The fixed-cost fixture adapter can propose bounded changes via propose-change; this report supplies no executed or audited proposal evidence.',
    trackingIssue: 10,
    requiredForRelease: false,
    available: true,
  },
  'versioned-signed-release': {
    reason: 'Semantic release planning is available via release; only the trusted GitHub workflow can publish or sign a release.',
    trackingIssue: 15,
    requiredForRelease: true,
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
    reason: 'certify verifies exact-revision gate reports, live GitHub checks/reviews/protection, open-defect limits, and the artifact/SBOM before writing a release certificate.',
    trackingIssue: 14,
    requiredForRelease: true,
    available: true,
  },
  'artifact-promotion': {
    reason: 'Certified release assets can be verified and promoted through the protected reference environment; this report contains no executed deployment receipt.',
    trackingIssue: 16,
    requiredForRelease: false,
    available: true,
  },
  'artifact-rollback': {
    reason: 'rollback evaluates correlated health failures and restores a compatible retained reference package; this report supplies no executed recovery evidence.',
    trackingIssue: 18,
    requiredForRelease: false,
    available: true,
  },
  'agent-remediation': {
    reason: 'Authorized bounded JSON formatting is available via remediate and local-remediate; local publication requires operator approval of the exact proposal digest. This report supplies no executed request evidence.',
    available: true,
    trackingIssue: 11,
    requiredForRelease: false,
  },
  'dependency-automation': {
    reason: 'npm update proposals and exact-head Dependabot merge evaluation are available via dependencies; this report supplies no update, approval, or merge evidence.',
    available: true,
    trackingIssue: 12,
    requiredForRelease: false,
  },
  'health-monitoring': {
    reason: 'Policy-driven endpoint monitoring records retained evidence and deduplicated GitHub incident/recovery notifications; automated rollback remains disabled.',
    trackingIssue: 17,
    requiredForRelease: false,
    available: true,
  },
  'release-publication': {
    reason: 'Versioned signed release publication is available via release; controlled reference deployment is available via promote. This report supplies no executed release or deployment evidence.',
    trackingIssue: 15,
    requiredForRelease: false,
    available: true,
  },
};

const args = process.argv.slice(2);
const [command, capability, requiredFlag] = args;

if (command === 'refresh-approvals' && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg, index) => index % 2 === 1 || ['--mode', '--repository', '--trigger-run', '--trusted-repo', '--trusted-revision'].includes(arg)) && new Set(args.filter((_, index) => index % 2 === 1)).size === (args.length - 1) / 2) {
  const options = Object.fromEntries(Array.from({ length: (args.length - 1) / 2 }, (_, index) => [args[index * 2 + 1], args[index * 2 + 2]]));
  const report = await (await import('./approval-refresh.mjs')).refreshApprovals(options);
  publish(report); process.exit(report.outcome === 'blocked' ? 1 : 0);
}

if (command === 'distribution' && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--mode','--trusted-repo','--trusted-revision','--factory-repository','--approved-revision','--consumer-repo','--source-revision','--output'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=await (await import('./factory-distribution.mjs')).distributeFactory(options);
  publish(report);process.exit(report.outcome==='passed'?0:1);
}

if (command === 'rollback' && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--mode','--repository','--actor','--trusted-repo','--trusted-revision','--environment','--deployment-receipt','--health-evidence','--state-directory'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=(await import('./artifact-rollback.mjs')).rollbackArtifact(options);
  publish(report);process.exit(['restored','eligible','not-required'].includes(report.outcome)?0:1);
}

if (command === 'dependencies' && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--mode','--trusted-repo','--trusted-revision','--repository','--pull-request','--output'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
 const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
 const report=options['--mode']==='update'?await (await import('./dependency-updater.mjs')).updateDependencies(options):await (await import('./dependency-maintenance.mjs')).maintainDependencies(options);publish(report);process.exit(report.outcome==='passed'?0:1);
}

if (command === 'release-artifact' && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--mode','--trusted-repo','--trusted-revision','--validation-evidence','--output-dir','--artifact-directory','--consumer-repo','--factory-repository','--approved-revision','--source-revision'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=await (await import('./release-artifact.mjs')).releaseArtifact(options);publish(report);process.exit(report.outcome==='passed'?0:1);
}

if (command === 'certify' && args.length >= 11 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--repository','--pull-request','--trusted-repo','--trusted-revision','--evidence','--artifact-directory','--output','--consumer-repo','--factory-repository','--approved-revision','--source-revision'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=await (await import('./release-certification.mjs')).certifyRelease(options);publish(report);process.exit(report.outcome==='certified'?0:1);
}

if (command === 'release' && args.length >= 17 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--mode','--repository','--source-revision','--actor','--trusted-repo','--certificate','--artifact-directory','--output-directory','--certificate-run','--certificate-run-metadata','--producer-run','--producer-run-metadata','--github-output'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2 && args[args.indexOf('--mode')+1] === 'prepare') {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=(await import('./release-management.mjs')).prepareRelease(options);publish(report);process.exit(report.outcome==='prepared'?0:1);
}

if (command === 'promote' && args.length >= 5 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--mode','--repository','--actor','--trusted-repo','--trusted-revision','--environment','--release-manifest','--certificate','--artifact-directory','--approval-evidence','--state-directory','--previous-stable','--output'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2 && args[args.indexOf('--mode')+1] === 'apply') {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=(await import('./artifact-promotion.mjs')).promoteArtifact(options);
  if(options['--output']) {
    const output=resolve(options['--output']);mkdirSync(dirname(output),{recursive:true});
    if(existsSync(output)){const prior=lstatSync(output);if(!prior.isFile()||prior.isSymbolicLink()||prior.nlink!==1)throw new Error('Promotion report output must be a regular file.');}
    writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:existsSync(output)?'w':'wx',mode:0o600});
  }
  publish(report);process.exit(report.outcome==='promoted'?0:1);
}

if (command === 'readiness' && args.length === 3 && args[1] === '--mode' && ['inspect', 'demonstrate'].includes(args[2])) {
  const readiness = await import('./readiness.mjs');
  const report = args[2] === 'inspect' ? readiness.inspectReadiness() : readiness.demonstrateReadiness();
  publish(report);
  process.exit(report.outcome === 'blocked' ? 1 : 0);
}

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
      report.operation === 'certify' ? 'Release certification evaluates exact-revision evidence and live GitHub controls; it does not publish a release or deploy.' :
      report.operation === 'release' ? 'Release preparation verifies exact-revision certification and artifact digests; it does not publish. The trusted GitHub release workflow signs and publishes.' :
      report.operation === 'promote' ? 'Promotion consumes an already-signed, certified release without rebuilding. GitHub Environment protection gates hosted execution.' :
      report.operation === 'rollback' ? 'Reference package restoration and integrity verification only; this report does not establish running service recovery or hosted authorization.' :
      report.operation === 'health-monitoring' ? 'Endpoint probe and GitHub incident evidence only; GitHub scheduling is best effort and this check does not page or roll back.' :
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

if (command === 'health-monitoring' && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--repository','--workload-id','--state-file','--evidence-output','--policy','--endpoint','--fixture-result','--run-url','--deployment-receipt'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=await (await import('./health-monitoring.mjs')).monitorHealth({
    repository: options['--repository'], workloadId: options['--workload-id'], stateFile: options['--state-file'],
    evidenceOutput: options['--evidence-output'], policyPath: options['--policy'], endpoint: options['--endpoint'],
    fixtureResult: options['--fixture-result'], runUrl: options['--run-url'], deploymentReceipt: options['--deployment-receipt'],
  });
  publish(report);process.exitCode=report.outcome==='passed'?0:1;
} else if (command === 'consumer-evidence' && args.length === 13 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--reports-directory','--source-revision','--trusted-revision','--base-revision','--review-head','--output'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === 6) {
  const options=Object.fromEntries(Array.from({length:6},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=(await import('./consumer-evidence.mjs')).assembleConsumerEvidence(options);publish(report);process.exitCode=report.outcome === 'passed'?0:1;} else if (command === 'local-remediate' && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--trusted-repo','--trusted-revision','--repository-path','--repository','--state-dir','--mode','--source-branch','--source-revision','--path','--request-id','--approve','--expected-proposal-digest','--private-key-path','--app-id','--installation-id'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=await (await import('./local-remediation.mjs')).localRemediate(options);publish(report);process.exitCode=report.outcome === 'passed'?0:1;
} else if (command === 'remediate' && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--trusted-repo','--trusted-revision','--repository-path','--repository','--state-dir','--mode'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const report=await (await import('./remediation.mjs')).remediate(options);publish(report);process.exitCode=report.outcome === 'passed'?0:1;
} else if (['propose-change','prune-agent-evidence'].includes(command) && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--trusted-repo','--trusted-revision','--repository-path','--proposal','--state-dir','--scope-id','--actor','--cancel-file'].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const runner=await import('./agent-runner.mjs');const report=command === 'propose-change'?await runner.proposeChange(options):runner.pruneAgentEvidence(options);publish(report);process.exitCode=report.outcome === 'passed'?0:1;
} else if (['governance','collect-governance','bootstrap-governance'].includes(command) && args.length >= 3 && args.length % 2 === 1 && args.slice(1).every((arg,index)=>index % 2 === 1 || ['--trusted-revision','--trusted-repo','--repository','--factory-repository','--approved-revision','--consumer-repo','--source-revision',...(command === 'governance'?['--evidence']:command === 'bootstrap-governance'?['--apply']:[])].includes(arg)) && new Set(args.filter((_,index)=>index % 2 === 1)).size === (args.length-1)/2) {
  const options=Object.fromEntries(Array.from({length:(args.length-1)/2},(_,i)=>[args[i*2+1],args[i*2+2]]));
  const governance=await import('./governance.mjs');
  const report=command === 'governance'?governance.evaluateGovernance(options):command === 'bootstrap-governance' && options['--apply'] !== 'true'?{operation:'governance',outcome:'blocked',results:[{capability:'repository-governance',required:true,status:'error',reason:'Bootstrap requires explicit --apply true.'}]}:await governance.collectGovernance(options);
  publish(report);process.exitCode=report.outcome === 'passed'?0:1;
} else if (['human-review', 'collect-reviews', 'policy', 'coverage', 'measure-coverage', 'security', 'scan-security', 'sast', 'collect-sast'].includes(command) && args.length >= 3 && args.length % 2 === 1 &&
  args.slice(1).every((arg, index) => index % 2 === 1 || ['--contract', '--trusted-repo', '--trusted-revision', ...(['human-review','collect-reviews'].includes(command) ? ['--base-revision','--repository','--pull-request','--coverage-evidence',...(command === 'collect-reviews' ? ['--merged-revision'] : []), ...(command === 'human-review' ? ['--evidence'] : ['--output'])] : ['security','sast'].includes(command) ? ['--evidence'] : command === 'collect-sast' ? ['--repository','--ref','--output','--analysis-key'] : command === 'scan-security' ? ['--tools-dir', '--output'] : ['--overrides', ...(command === 'coverage' ? ['--evidence', '--base-revision'] : command === 'measure-coverage' ? ['--base-revision', '--output'] : [])])].includes(arg)) &&
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
  (args.length === 1 || (args.length === 3 && ((args[1] === '--contract' || command === 'validate' && args[1] === '--evidence-output') && args[2]) || args.length === 5 && command === 'validate' && args[1] === '--contract' && args[2] && args[3] === '--evidence-output' && args[4]))) {
  const { runContract } = await import('./contract-execution.mjs');
  const contractIndex=args.indexOf('--contract'),contractPath=contractIndex<0?'factory-contract.yaml':args[contractIndex+1];
  const report = await runContract(contractPath, command === 'profile');
  const evidenceIndex=args.indexOf('--evidence-output');
  if(evidenceIndex>=0) {const evidencePath=resolve(args[evidenceIndex+1]);mkdirSync(dirname(evidencePath),{recursive:true});if(existsSync(evidencePath)){const prior=lstatSync(evidencePath);if(!prior.isFile()||prior.isSymbolicLink()||prior.nlink!==1)throw new Error('Validation evidence output must be a regular file.');}writeFileSync(evidencePath,JSON.stringify({schemaVersion:1,...report},null,2)+'\n',{flag:existsSync(evidencePath)?'w':'wx'});}
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
  console.error('Usage: factory-validation.mjs distribution --mode <inspect|validate> --trusted-repo <factory-path> --trusted-revision <SHA> --factory-repository <owner/repo> --approved-revision <SHA> --consumer-repo <path> [--source-revision <SHA> --output <file>] | rollback --mode <evaluate|apply> --repository <owner/repo> --actor <login> --trusted-repo <path> --trusted-revision <SHA> --environment reference --state-directory <external-dir> --deployment-receipt <receipt.json> --health-evidence <health.json> | health-monitoring --repository <owner/repo> --workload-id <id> --state-file <file> --evidence-output <file> [--run-url <url>] | promote --mode apply --repository <owner/repo> --actor <login> --trusted-repo <path> --trusted-revision <SHA> --environment <name> --release-manifest <manifest.json> --certificate <certificate.json> --artifact-directory <assets-dir> --approval-evidence <github-environment-evidence.json> --state-directory <external-dir> [--previous-stable <deployment.json>] [--output <receipt.json>] | release --mode prepare --repository <owner/repo> --source-revision <SHA> --actor <login> --trusted-repo <path> --certificate <json> --artifact-directory <dir> --output-directory <new-dir> [--certificate-run <id> --certificate-run-metadata <json> --producer-run <id> --producer-run-metadata <json>] | local-remediate --mode <prepare|publish> --repository <owner/repo> --trusted-revision <SHA> --repository-path <path> --source-branch <feat/branch> --source-revision <SHA> --path <file.json> --request-id <digits> --state-dir <external-dir> | remediate --mode <authorize|prepare|publish> --repository <owner/repo> --trusted-revision <SHA> --repository-path <path> --state-dir <external-dir> | propose-change --trusted-revision <SHA> --repository-path <path> --proposal <file> --state-dir <external-dir> --scope-id <id> --actor <identity> | prune-agent-evidence --trusted-revision <SHA> --state-dir <external-dir> --scope-id <id> | inventory | capability <name> [--required] | certify | validate [--contract <path>] [--evidence-output <file>] | profile [--contract <path>] | sast --trusted-revision <SHA> --evidence <file> | collect-sast --trusted-revision <SHA> --repository <owner/repo> --ref <exact-ref> [--output <file>] | scan-security --trusted-revision <SHA> [--tools-dir <path>] [--output <file>] | security --trusted-revision <SHA> --evidence <file> | measure-coverage --trusted-revision <SHA> --base-revision <SHA> [--output <file>] | coverage --trusted-revision <SHA> --base-revision <SHA> --evidence <file> | policy --trusted-revision <SHA> [--trusted-repo <path>] [--contract <path>] [--overrides <path>]');
  process.exitCode = 2;
}
