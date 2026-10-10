import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { approvedExceptions, digest, document, git, requireWorkloadProfile } from './policy-evaluation.mjs';

/** @typedef {{path: string, source_digest: string, lines: Record<string, number>, branches: Array<{id: string, line: number, end_line: number, hits: number}>}} FileCoverage */
/** @typedef {{revision: string, status: string, exit_code: number | null}} TestResult */
/** @typedef {{version: string, revision: string, base_revision: string, workload_id: string, profile: string, contract_digest: string, files: FileCoverage[], baseline: {revision: string, files: FileCoverage[]}, tests: {unit: TestResult, integration: TestResult}}} Evidence */
/** @typedef {{coverage_thresholds: {global_minimum_percentage: number, new_code_minimum_percentage: number}, allow_coverage_decrease: boolean, require_unit_tests: boolean, require_integration_tests: boolean}} TestingPolicy */

/** Read Git blobs without newline normalization. @param {string} repo @param {string[]} args */
export function rawGit(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error('Coverage source revision or diff could not be read.');
  return result.stdout;
}
/** @param {Record<string,string>} options */
export function coverageContext(options) {
  const contractPath = realpathSync(options['--contract'] ?? 'factory-contract.yaml');
  const repo = git(dirname(contractPath), ['rev-parse', '--show-toplevel']);
  const revision = git(repo, ['rev-parse', 'HEAD']);
  const base = options['--base-revision'], trusted = options['--trusted-revision'];
  for (const sha of [base, trusted]) if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Full pinned baseline and trusted-policy commit SHAs are required.');
  const trustedRepo = resolve(options['--trusted-repo'] ?? repo);
  if (git(trustedRepo, ['cat-file', '-t', trusted]) !== 'commit' || git(repo, ['cat-file', '-t', base]) !== 'commit') throw new Error('Baseline and trusted revision must identify commits.');
  rawGit(repo, ['merge-base', '--is-ancestor', base, revision]);
  const source = readFileSync(contractPath, 'utf8');
  const contract = /** @type {import('./contract-execution.mjs').Contract} */ (document('factory-contract', source)).contract;
  const cwd = realpathSync(resolve(dirname(contractPath), contract.working_directory));
  const within = relative(dirname(contractPath), cwd);
  if (isAbsolute(contract.working_directory) || within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) throw new Error('Coverage workload must remain inside the contract directory.');
  const workloadPath = relative(repo, cwd).split(sep).join('/');
  const sourcePath = (workloadPath ? workloadPath + '/' : '') + 'src/';
  requireWorkloadProfile(trustedRepo, trusted, contract.profile);
  const qualitySource = rawGit(trustedRepo, ['show', `${trusted}:policies/quality.yaml`]);
  const quality = /** @type {{quality: {testing: TestingPolicy, linting: {allow_suppression_comments: boolean}}}} */ (document('quality-policy', qualitySource)).quality;
  const ledger = /** @type {import('./policy-evaluation.mjs').Policy} */ (document('factory-policy', rawGit(trustedRepo, ['show', `${trusted}:policies/enforcement.yaml`])));
  return { repo, revision, base, trusted, trustedRepo, contract, contractDigest: digest(source), quality, qualityDigest: digest(qualitySource), ledger, sourcePath, workloadPath };
}
/** @param {string} repo @param {string} revision @param {string} sourcePath */
export function sourceFiles(repo, revision, sourcePath) {
  const entries = rawGit(repo, ['ls-tree', '-r', '-z', revision, '--', sourcePath]).split('\0').filter(Boolean);
  return entries.filter(entry => entry.slice(entry.indexOf('\t') + 1).match(/\.(?:mjs|ts)$/)).map(entry => {
    const [metadata, path] = entry.split('\t');
    if (!/^100(644|755) blob /.test(metadata) || /[\r\n\\]/.test(path)) throw new Error('Unsupported coverage source path or file mode.');
    return path;
  });
}
/** @param {string} repo @param {string} revision @param {string} prefix @param {FileCoverage[]} files @param {boolean} allowSuppressions */
function verifyFiles(repo, revision, prefix, files, allowSuppressions) {
  const expected = sourceFiles(repo, revision, prefix);
  if (!expected.length || files.length !== expected.length || new Set(files.map(file => file.path)).size !== files.length) throw new Error('Coverage evidence must include every tracked Node source file exactly once.');
  for (const file of files) {
    if (!expected.includes(file.path)) throw new Error('Coverage file is outside the supported source scope.');
    const source = rawGit(repo, ['show', `${revision}:${file.path}`]);
    if (digest(source) !== file.source_digest) throw new Error('Coverage source digest is stale.');
    if (!allowSuppressions && /(?:c8|istanbul)\s+ignore/.test(source)) throw new Error('Coverage suppression comments violate trusted Quality policy.');
    const lines = source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
    if (Object.keys(file.lines).length !== lines || Object.keys(file.lines).some(line => Number(line) > lines)) throw new Error('Coverage line evidence is incomplete or malformed.');
    if (new Set(file.branches.map(branch => branch.id)).size !== file.branches.length || file.branches.some(branch => branch.line > lines || branch.end_line > lines || branch.end_line < branch.line)) throw new Error('Coverage branch evidence is malformed.');
  }
}
/** @param {number[]} counts */
function metric(counts) {
  const total = counts.length, covered = counts.filter(count => count > 0).length;
  return { total, covered, percentage: total ? covered * 100 / total : null, status: total ? 'measured' : 'not-applicable' };
}
/** @param {FileCoverage[]} files @param {Map<string,Set<number>> | undefined} changes */
function metrics(files, changes = undefined) {
  return {
    lines: metric(files.flatMap(file => Object.entries(file.lines).filter(([line]) => !changes || changes.get(file.path)?.has(Number(line))).map(([, count]) => count))),
    branches: metric(files.flatMap(file => file.branches.filter(branch => !changes || [...(changes.get(file.path) ?? [])].some(line => line >= branch.line && line <= branch.end_line)).map(branch => branch.hits))),
  };
}
/** @param {Record<string,string>} options @param {Evidence | undefined} supplied */
export function evaluateCoverage(options, supplied = undefined) {
  try {
    const context = coverageContext(options);
    const evidence = /** @type {Evidence} */ (document('coverage-evidence', supplied ? JSON.stringify(supplied) : readFileSync(options['--evidence'], 'utf8')));
    if (evidence.revision !== context.revision || evidence.base_revision !== context.base || evidence.baseline.revision !== context.base || evidence.workload_id !== context.contract.workload_id || evidence.profile !== context.contract.profile || evidence.contract_digest !== context.contractDigest) throw new Error('Coverage evidence is stale or out of scope for the selected revisions and contract.');
    verifyFiles(context.repo, context.revision, context.sourcePath, evidence.files, context.quality.linting.allow_suppression_comments);
    verifyFiles(context.repo, context.base, context.sourcePath, evidence.baseline.files, context.quality.linting.allow_suppression_comments);
    const policy = structuredClone(context.quality.testing);
    const exceptions = approvedExceptions(options, context.ledger, { revision: context.revision, contractDigest: context.contractDigest, workloadId: context.contract.workload_id, profile: context.contract.profile, baseRevision: context.base });
    for (const exception of exceptions) {
      const rule = exception.rule.replace(/^coverage\./, '');
      if (rule === 'global_minimum_percentage' || rule === 'new_code_minimum_percentage') policy.coverage_thresholds[rule] = /** @type {number} */ (exception.value);
      else if (rule === 'allow_coverage_decrease' || rule === 'require_unit_tests' || rule === 'require_integration_tests') policy[rule] = /** @type {boolean} */ (exception.value);
    }
    /** @type {Map<string,Set<number>>} */
    const changes = new Map();
    for (const file of evidence.files) {
      const lines = new Set();
      const diff = rawGit(context.repo, ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', context.base, context.revision, '--', file.path]);
      for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
        const start = Number(match[1]), length = match[2] === undefined ? 1 : Number(match[2]);
        for (let line = start; line < start + length; line++) lines.add(line);
      }
      changes.set(file.path, lines);
    }
    const global = metrics(evidence.files), baseline = metrics(evidence.baseline.files), changed = metrics(evidence.files, changes);
    const results = ['unit', 'integration'].map(name => {
      const evidenceResult = evidence.tests[/** @type {'unit'|'integration'} */ (name)];
      const required = name === 'unit' ? policy.require_unit_tests : policy.require_integration_tests;
      const passed = evidenceResult.revision === context.revision && evidenceResult.status === 'passed' && evidenceResult.exit_code === 0;
      return { capability: `${name}-tests`, required, status: passed ? 'passed' : 'failed', reason: passed ? 'Tests passed for the current source revision.' : 'Test evidence is missing, failed, or stale.' };
    });
    for (const dimension of /** @type {const} */ (['lines', 'branches'])) {
      const total = global[dimension], delta = changed[dimension], prior = baseline[dimension];
      const passed = (total.percentage === null || total.covered * 100 >= policy.coverage_thresholds.global_minimum_percentage * total.total) &&
        (delta.percentage === null || delta.covered * 100 >= policy.coverage_thresholds.new_code_minimum_percentage * delta.total) &&
        (policy.allow_coverage_decrease || total.percentage === null || prior.percentage === null || total.covered * prior.total >= prior.covered * total.total);
      results.push({ capability: `coverage-${dimension}`, required: true, status: passed ? 'passed' : 'failed', reason: `${passed ? 'Satisfied' : 'Failed'} ${dimension}: global ${total.covered}/${total.total} vs ${policy.coverage_thresholds.global_minimum_percentage}%; changed ${delta.covered}/${delta.total} vs ${policy.coverage_thresholds.new_code_minimum_percentage}%; baseline ${prior.covered}/${prior.total}; decrease allowed: ${policy.allow_coverage_decrease}.` });
    }
    return { operation: 'coverage', outcome: results.some(result => result.required && result.status !== 'passed') ? 'blocked' : 'passed', revision: context.revision, baseRevision: context.base, trustedRevision: context.trusted, evidenceDigest: digest(JSON.stringify(evidence)), qualityDigest: context.qualityDigest, contractDigest: context.contractDigest, effectivePolicy: policy, exceptions: exceptions.map(exception => ({ id: exception.id, evidenceId: exception.evidence_id, approver: exception.approver, expiresAt: exception.expires_at })), metrics: { global, baseline, changed }, results };
  } catch (error) {
    return { operation: 'coverage', outcome: 'blocked', results: [{ capability: 'coverage', required: true, status: 'failed', reason: error instanceof Error ? error.message : String(error) }] };
  }
}
