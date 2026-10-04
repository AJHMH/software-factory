import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { rawGit } from './coverage-evaluation.mjs';

const sha = /^[a-f0-9]{40}$/;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** @param {string} reason */
const fail = reason => { console.error(reason); process.exitCode = 1; };
/** @param {string[]} args @returns {Record<string,string>} */
function parseArgs(args) {
  if (args.length % 2 !== 0) throw new Error('Options require key-value pairs.');
  /** @type {Record<string,string>} */ const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key.startsWith('--') || Object.hasOwn(values, key) || !args[index + 1]) throw new Error('Invalid or duplicate workflow option.');
    values[key] = args[index + 1];
  }
  return values;
}
/** @param {string} repo @param {string[]} args */
function git(repo, args) { return rawGit(repo, args).trim(); }
/** @param {string[]} args @param {string|undefined} input */
function gh(args, input = undefined) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input, windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error('GitHub deployment API request failed.');
  try { return JSON.parse(result.stdout); } catch { throw new Error('GitHub deployment API returned invalid JSON.'); }
}
/** @param {string} path @param {Record<string,unknown>} value */
function writeJson(path, value) {
  const output = resolve(path);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

try {
  const [command, ...rawOptions] = process.argv.slice(2), options = parseArgs(rawOptions);
  const repository = options['--repository'], environment = options['--environment'];
  if (!repoPattern.test(repository ?? '') || !/^[a-z][a-z0-9-]{0,30}$/.test(environment ?? '')) throw new Error('Repository and configured environment are required.');
  const repo = resolve(options['--trusted-repo'] ?? '.'), trustedRevision = options['--trusted-revision'];
  if (!sha.test(trustedRevision ?? '') || git(repo, ['rev-parse', 'HEAD']) !== trustedRevision) throw new Error('Promotion workflow must run from its exact trusted main revision.');
  const deployment = parse(git(repo, ['show', `${trustedRevision}:policies/deployment.yaml`]))?.deployment;
  const release = parse(git(repo, ['show', `${trustedRevision}:policies/release.yaml`]))?.release;
  const envPolicy = deployment?.environments?.[environment];
  if (!envPolicy?.enabled || !envPolicy.approval_required || deployment.workflow !== '.github/workflows/factory-promote-reference.yml' ||
      deployment.approval_provider !== 'github-environment-protection' || !Array.isArray(release?.authorization?.authorized_actors)) throw new Error('Trusted deployment policy is missing or does not support this environment.');

  if (command === 'authorize') {
    const actor = options['--actor'], sourceRevision = options['--source-revision'], releaseTag = options['--release-tag'];
    if (!release.authorization.authorized_actors.includes(actor ?? '')) throw new Error('The requesting GitHub actor is not authorized.');
    if (options['--event'] !== 'workflow_dispatch' || options['--ref'] !== 'refs/heads/main' || options['--run-attempt'] !== '1') throw new Error('Promotion requires a first-attempt dispatch from main.');
    if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(releaseTag ?? '') || !sha.test(sourceRevision ?? '') || git(repo, ['cat-file', '-t', sourceRevision]) !== 'commit') throw new Error('A semantic release tag and exact source commit are required.');
    const ancestry = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', sourceRevision, trustedRevision], { encoding: 'utf8', windowsHide: true });
    if (ancestry.status !== 0) throw new Error('The requested source revision is not an ancestor of the trusted main revision.');
    console.log(JSON.stringify({ operation: 'promotion-authorize', outcome: 'passed', repository, environment, actor, sourceRevision, releaseTag, trustedRevision }));
  } else if (command === 'approval') {
    const actor = options['--actor'], sourceRevision = options['--source-revision'];
    if (!release.authorization.authorized_actors.includes(actor ?? '') || !sha.test(sourceRevision ?? '') || git(repo, ['cat-file', '-t', sourceRevision]) !== 'commit' || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '')) throw new Error('The protected environment request is not authorized.');
    writeJson(options['--output'], { schemaVersion: 1, repository, environment, gate: 'approved', gateSource: deployment.approval_provider, workflow: deployment.workflow,
      runId: process.env.GITHUB_RUN_ID, actor, trustedRevision });
    console.log(JSON.stringify({ operation: 'promotion-approval-evidence', outcome: 'passed', environment, runId: process.env.GITHUB_RUN_ID }));
  } else if (command === 'previous') {
    const pages = gh(['api', '--paginate', '--slurp', `repos/${repository}/deployments?environment=${encodeURIComponent(environment)}&per_page=100`]);
    const deployments = Array.isArray(pages) ? pages.flat() : pages;
    if (!Array.isArray(deployments)) throw new Error('GitHub deployment history is unavailable.');
    let previousStable = null;
    for (const item of deployments) {
      if (item.environment !== environment || item.task !== 'deploy:factory-reference-v1' || !Number.isSafeInteger(item.id)) continue;
      const statuses = gh(['api', `repos/${repository}/deployments/${item.id}/statuses?per_page=1`]);
      if (!Array.isArray(statuses) || statuses[0]?.state !== 'success' || !item.payload || typeof item.payload !== 'object') continue;
      const receipt = item.payload;
      if (receipt.operation !== 'promote' || receipt.outcome !== 'promoted' || receipt.environment !== environment || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(receipt.tag ?? '') ||
          !sha.test(receipt.revision ?? '') || !/^[a-f0-9]{64}$/.test(receipt.artifactDigest ?? '')) continue;
      previousStable = { environment, outcome: 'success', tag: receipt.tag, version: receipt.version, sourceRevision: receipt.revision, artifactDigest: receipt.artifactDigest, deploymentId: String(item.id) };
      break;
    }
    writeJson(options['--output'], previousStable ?? { environment, outcome: 'none' });
    console.log(JSON.stringify({ operation: 'previous-stable', outcome: 'passed', environment, found: Boolean(previousStable) }));
  } else if (command === 'record') {
    const report = JSON.parse(readFileSync(resolve(options['--receipt']), 'utf8'));
    if (report.operation !== 'promote' || report.outcome !== 'promoted' || report.repository?.toLowerCase() !== repository.toLowerCase() || report.environment !== environment || report.approval?.provider !== deployment.approval_provider || report.approval?.environment !== environment || report.approval?.workflow !== deployment.workflow || report.approval?.actor !== report.actor || !release.authorization.authorized_actors.includes(report.actor) || !sha.test(report.revision ?? '') || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(report.tag ?? '') || !/^\d+\.\d+\.\d+$/.test(report.version ?? '') || !/^[a-f0-9]{64}$/.test(report.artifactDigest ?? '') || !/^[a-f0-9]{64}$/.test(report.sbomDigest ?? '') || report.health?.status !== 'passed' || !/^\d+$/.test(report.approval?.runId ?? '') || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') || !process.env.GITHUB_SERVER_URL) throw new Error('A successful exact-environment promotion receipt is required.');
    const body = { ref: report.revision, task: 'deploy:factory-reference-v1', auto_merge: false, required_contexts: [], environment,
      description: `Factory reference promotion ${report.tag}; artifact ${report.artifactDigest}`, payload: report };
    const deploymentRecord = gh(['api', '--method', 'POST', `repos/${repository}/deployments`, '--input', '-'], JSON.stringify(body));
    if (!Number.isSafeInteger(deploymentRecord.id)) throw new Error('GitHub did not create the promotion deployment record.');
    gh(['api', '--method', 'POST', `repos/${repository}/deployments/${deploymentRecord.id}/statuses`, '--input', '-'], JSON.stringify({ state: 'success', description: `Promoted ${report.tag} after configured health checks.`, log_url: `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` }));
    console.log(JSON.stringify({ operation: 'promotion-record', outcome: 'success', environment, deploymentId: String(deploymentRecord.id) }));
  } else {
    throw new Error('Use authorize, approval, previous, or record.');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : 'Promotion workflow operation failed.');
}
