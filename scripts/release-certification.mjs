import { existsSync, lstatSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import Ajv from 'ajv';
import { collectGovernance } from './governance.mjs';
import { digest, git } from './policy-evaluation.mjs';
import { releaseArtifact } from './release-artifact.mjs';

const severity = ['critical', 'high', 'medium', 'low'];
const endpoint = 'https://api.github.com/';
const certificationSchema = JSON.parse(readFileSync(new URL('../schemas/release-certification.schema.json', import.meta.url), 'utf8'));
const validateBundle = new Ajv.default({ allErrors: true, strict: true }).compile(certificationSchema);
/** @typedef {Record<string, any>} Json */
/** @typedef {{fetchImpl?:typeof fetch,collectGovernance?:(repository:string,trusted:string,trustedRepo:string)=>Promise<Json>,releaseArtifact?:(revision:string,directory:string)=>Promise<Json>}} Dependencies */

/** Fetch a bounded GitHub REST collection. A full page is ambiguous and blocks certification. */
/** @param {string} path @param {typeof fetch} fetchImpl */
async function github(path, fetchImpl) {
  const token = process.env.FACTORY_GITHUB_TOKEN;
  if (!token) throw new Error('FACTORY_GITHUB_TOKEN is required to verify live GitHub release evidence.');
  const url = new URL(path, endpoint);
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: {
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
  } });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}; live release evidence is unavailable.`);
  return response.json();
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** @param {unknown} report @param {string} name @param {string} revision @param {string} [trusted] @param {string} [base] */
function requireReport(report, name, revision, trusted, base) {
  if (!object(report)) throw new Error(`${name} evidence is missing, failed, incomplete, or does not match the release revision.`);
  const evidenceDigest = name === 'validate' ? report?.contractDigest : report?.evidenceDigest;
  const policyDigest = name === 'coverage' ? report?.qualityDigest : report?.policyDigest;
  if (!object(report) || report.operation !== name || report.outcome !== 'passed' || report.revision !== revision || !Array.isArray(report.results) || report.results.length === 0 ||
      report.results.some(gate => !object(gate) || gate.required !== false && gate.status !== 'passed') ||
      !/^[a-f0-9]{64}$/.test(evidenceDigest ?? '') || name !== 'validate' && !/^[a-f0-9]{64}$/.test(policyDigest ?? '')) {
    throw new Error(`${name} evidence is missing, failed, incomplete, or does not match the release revision.`);
  }
  if (trusted && report.trustedRevision !== trusted) throw new Error(`${name} evidence used a different trusted policy revision.`);
  if (base && report.baseRevision !== base) throw new Error(`${name} evidence used a different base revision.`);
}

/** @param {Record<string,string>} options @param {Dependencies} [dependencies] */
export async function certifyRelease(options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  try {
    const repository = options['--repository'], trusted = options['--trusted-revision'];
    const prNumber = Number(options['--pull-request']);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(trusted ?? '') || !Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Repository, full trusted revision, and pull request number are required.');
    const trustedRepo = resolve(options['--trusted-repo'] ?? '.');
    if (git(trustedRepo, ['cat-file', '-t', trusted]) !== 'commit') throw new Error('Trusted policy revision must identify a commit.');
    /** @param {string} path */ const policyFile = (path) => git(trustedRepo, ['show', `${trusted}:${path}`]);
    const governancePolicy = parse(policyFile('policies/governance.yaml'))?.governance?.repository_protection;
    const humanPolicy = parse(policyFile('policies/human-review.yaml'))?.human_review;
    const quality = parse(policyFile('policies/quality.yaml'))?.quality?.release_readiness;
    const dependencyPolicy = parse(policyFile('policies/dependencies.yaml'))?.dependencies;
    if (!Array.isArray(governancePolicy?.required_checks) || !Array.isArray(humanPolicy?.human_approvers) || !quality || !dependencyPolicy?.artifact) throw new Error('Trusted release policies or mandatory metadata are missing.');
    const evidence = /** @type {Json} */ (JSON.parse(readFileSync(resolve(options['--evidence']), 'utf8')));
    if (!validateBundle(evidence)) throw new Error('Release evidence bundle is malformed or incomplete.');
    const revision = evidence.revision;
    if (git(trustedRepo, ['cat-file', '-t', revision]) !== 'commit') throw new Error('Certified release revision is unavailable in the trusted checkout.');
    requireReport(evidence.reports.validation, 'validate', revision);
    requireReport(evidence.reports.policy, 'policy', revision, trusted);
    requireReport(evidence.reports.coverage, 'coverage', revision, trusted);
    requireReport(evidence.reports.security, 'security', revision, trusted);
    requireReport(evidence.reports.sast, 'sast', revision, trusted);
    requireReport(evidence.reports.human_review, 'human-review', revision, trusted);
    const coverageBase = evidence.reports.coverage.baseRevision;
    if (!/^[a-f0-9]{40}$/.test(coverageBase ?? '') || git(trustedRepo, ['cat-file', '-t', coverageBase]) !== 'commit' || git(trustedRepo, ['merge-base', '--is-ancestor', coverageBase, revision]) !== '') throw new Error('Coverage baseline is missing, invalid, or outside the certified source history.');
    const apiPrefix = `repos/${repository}`;
    const pr = await github(`${apiPrefix}/pulls/${prNumber}`, fetchImpl);
    if (pr.merged !== true || pr.state !== 'closed' || pr.head?.sha !== revision || pr.base?.ref !== 'main') throw new Error('The pull request must be merged into main at the exact evidence revision.');
    if (pr.base?.sha !== coverageBase) throw new Error('Coverage evidence baseline does not match the pull request base revision.');
    const [checkData, reviews, issueData] = await Promise.all([
      github(`${apiPrefix}/commits/${revision}/check-runs?filter=latest&per_page=100`, fetchImpl),
      github(`${apiPrefix}/pulls/${prNumber}/reviews?per_page=100`, fetchImpl),
      github(`${apiPrefix}/issues?state=open&per_page=100`, fetchImpl),
    ]);
    if (!object(checkData) || !Array.isArray(checkData.check_runs) || checkData.check_runs.length >= 100 || !Array.isArray(reviews) || reviews.length >= 100 || !Array.isArray(issueData) || issueData.length >= 100) throw new Error('GitHub returned a truncated or malformed release evidence collection.');
    const checks = checkData.check_runs;
    for (const required of governancePolicy.required_checks) {
      const matched = checks.filter(check => check.name === required.context && check.app?.id === required.integration_id && check.head_sha === revision);
      if (!matched.length || matched.some(check => check.status !== 'completed' || check.conclusion !== 'success')) throw new Error(`Required GitHub check "${required.context}" is missing, stale, or unsuccessful.`);
    }
    const reviewerStates = new Map();
    for (const review of [...reviews].sort((a, b) => Date.parse(a.submitted_at ?? 0) - Date.parse(b.submitted_at ?? 0))) {
      if (!review.user?.login || !review.submitted_at || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED'].includes(review.state)) continue;
      if (review.state !== 'COMMENTED') reviewerStates.set(review.user.login.toLowerCase(), review);
    }
    const allow = new Set(humanPolicy.human_approvers.map((/** @type {string} */ login) => login.toLowerCase()));
    const agentAccounts = new Set((humanPolicy.agent_accounts ?? []).map((/** @type {string} */ login) => login.toLowerCase()));
    const exceptionParticipants = new Set(Object.values(evidence.reports).flatMap(report => (report.exceptions ?? []).flatMap((/** @type {Json} */ exception) => [String(exception.approver ?? '').toLowerCase(), String(exception.owner ?? '').toLowerCase()]).filter(Boolean)));
    const approvals = [...reviewerStates.values()].filter(review => review.state === 'APPROVED' && review.commit_id === revision && review.user.type === 'User' && allow.has(review.user.login.toLowerCase()) && !agentAccounts.has(review.user.login.toLowerCase()) && !exceptionParticipants.has(review.user.login.toLowerCase()) && review.user.login.toLowerCase() !== pr.user?.login?.toLowerCase());
    const requiredApprovals = evidence.reports.human_review.requiredApprovals;
    if (!Number.isSafeInteger(requiredApprovals) || requiredApprovals < governancePolicy.minimum_approvals || approvals.length < requiredApprovals || [...reviewerStates.values()].some(review => review.state === 'CHANGES_REQUESTED')) throw new Error('Current independent human review requirements are not satisfied.');
    if (evidence.reports.human_review.repository?.toLowerCase() !== repository.toLowerCase() || evidence.reports.human_review.pullRequest !== prNumber || !Array.isArray(evidence.reports.human_review.approvals) || evidence.reports.human_review.approvals.length < requiredApprovals || (evidence.reports.human_review.changesRequested ?? []).length) throw new Error('Human-review report does not match this pull request or its current approval requirement.');
    for (const item of evidence.reports.human_review.approvals) if (!approvals.some(review => review.id === item.id && review.user.login.toLowerCase() === item.login.toLowerCase() && review.commit_id === item.revision)) throw new Error('A recorded human approval is stale, dismissed, or absent from live GitHub review history.');
    for (const approval of approvals) {
      const permission = await github(`${apiPrefix}/collaborators/${encodeURIComponent(approval.user.login)}/permission`, fetchImpl);
      if (!['write', 'maintain', 'admin'].includes(permission.permission)) throw new Error('A counted reviewer does not have write access required by repository protection.');
    }
    const governance = /** @type {Json} */ (dependencies.collectGovernance ? await dependencies.collectGovernance(repository, trusted, trustedRepo) : await collectGovernance({ '--repository': repository, '--trusted-revision': trusted, '--trusted-repo': trustedRepo }));
    if (governance.outcome !== 'passed' || governance.enforcementEvidence !== 'live GitHub ruleset configuration; runtime authorization is not certified') throw new Error('Live GitHub repository protections do not satisfy trusted Governance policy.');
    const openDefects = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const issue of issueData.filter((/** @type {Json} */ item) => !item.pull_request && (item.labels ?? []).some((/** @type {Json} */ label) => label.name === 'defect'))) {
      const levels = (issue.labels ?? []).map((/** @type {Json} */ label) => label.name).filter((/** @type {string} */ name) => name.startsWith('severity:'));
      const level = levels.map((/** @type {string} */ name) => name.slice('severity:'.length)).filter((/** @type {string} */ name) => severity.includes(name));
      if (level.length !== 1 || levels.length !== 1) throw new Error(`Open defect #${issue.number} lacks exactly one supported severity label.`);
      openDefects[/** @type {'critical'|'high'|'medium'|'low'} */ (level[0])]++;
    }
    const limits = quality.max_open_defects_severity;
    if (!object(limits) || !Number.isSafeInteger(limits.medium) || !Number.isSafeInteger(limits.low) || !severity.includes(quality.zero_open_defects_severity)) throw new Error('Trusted open-defect limits are missing or invalid.');
    const zeroAt = severity.indexOf(quality.zero_open_defects_severity);
    if (severity.slice(0, zeroAt + 1).some(level => openDefects[/** @type {'critical'|'high'|'medium'|'low'} */ (level)] > 0) || openDefects.medium > limits.medium || openDefects.low > limits.low) throw new Error('Open defect counts exceed trusted release limits.');
    const assurance = dependencyPolicy.release_assurance ?? {};
    if (!object(assurance) || assurance.max_dependency_age_days !== undefined && assurance.max_dependency_age_days !== null && (!Number.isSafeInteger(assurance.max_dependency_age_days) || assurance.max_dependency_age_days < 1) || assurance.require_provenance_attestation !== undefined && typeof assurance.require_provenance_attestation !== 'boolean') throw new Error('Trusted dependency-age or provenance policy is malformed.');
    if (assurance.max_dependency_age_days !== undefined && assurance.max_dependency_age_days !== null || assurance.require_provenance_attestation === true) throw new Error('Configured dependency-age or provenance policy requires metadata not supported by the available SBOM.');
    const artifact = /** @type {Json} */ (dependencies.releaseArtifact ? await dependencies.releaseArtifact(revision, resolve(options['--artifact-directory'] ?? '')) : await releaseArtifact({ '--mode': 'verify', '--trusted-repo': trustedRepo, '--trusted-revision': revision, '--artifact-directory': resolve(options['--artifact-directory'] ?? '') }));
    if (artifact.outcome !== 'passed' || !/^[a-f0-9]{64}$/.test(artifact.artifactDigest ?? '') || !/^[a-f0-9]{64}$/.test(artifact.sbomDigest ?? '')) throw new Error('The exact-revision build artifact or SBOM failed verification.');
    if (artifact.validationEvidenceDigest !== digest(JSON.stringify(evidence.reports.validation))) throw new Error('Factory validation evidence does not match the verified artifact bundle.');
    const dependencySource = artifact.dependencySource;
    if (!dependencySource || dependencySource.ecosystem !== 'npm' || dependencySource.registry !== dependencyPolicy.artifact.dependency_registry || dependencySource.lockfile !== dependencyPolicy.artifact.source_lockfile || dependencySource.lockfileVersion !== dependencyPolicy.artifact.lockfile_version || dependencySource.includesDevelopmentDependencies !== dependencyPolicy.artifact.include_development_dependencies || dependencySource.packageCount !== artifact.dependencyCount) throw new Error('Registry, lockfile, or dependency-source metadata is missing or differs from trusted policy.');
    const certificateExceptions = Object.entries(evidence.reports).flatMap(([gate, report]) => (report.exceptions ?? []).map((/** @type {Json} */ exception) => {
      const expiresAt = exception.expiresAt ?? exception.expires_at;
      const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN;
      if (typeof exception.id !== 'string' || !exception.id || typeof exception.evidenceId !== 'string' || !exception.evidenceId || typeof exception.approver !== 'string' || !exception.approver || !Number.isFinite(expiry) || new Date(expiry).toISOString() !== expiresAt || expiry <= Date.now()) throw new Error('Exception evidence is missing an approver or has expired or invalid expiry metadata.');
      return { gate, id: exception.id, evidenceId: exception.evidenceId, approver: exception.approver, expiresAt };
    }));
    const exceptionMetadata = new Map();
    for (const exception of certificateExceptions) {
      const key = `${exception.id}:${exception.evidenceId}`;
      const metadata = `${exception.approver.toLowerCase()}:${exception.expiresAt}`;
      if (exceptionMetadata.has(key) && exceptionMetadata.get(key) !== metadata) throw new Error('Exception evidence disagrees across release gate reports.');
      exceptionMetadata.set(key, metadata);
    }
    const reportDigests = Object.fromEntries(Object.entries(evidence.reports).map(([key, report]) => [key, report.evidenceDigest ?? report.contractDigest]));
    const certifiedAt = new Date().toISOString();
    const certificate = {
      schemaVersion: 1, operation: 'certify', outcome: 'certified', repository, pullRequest: prNumber, revision, baseRevision: coverageBase, hostedBaseRevision: pr.base.sha,
      trustedRevision: trusted, certifiedAt, approvers: approvals.map(review => ({ login: review.user.login, reviewId: review.id, revision: review.commit_id })),
      policyDigests: { governance: governance.policyDigest, execution: evidence.reports.policy.policyDigest, quality: evidence.reports.coverage.qualityDigest, security: evidence.reports.security.policyDigest, sast: evidence.reports.sast.policyDigest, contract: evidence.reports.validation.contractDigest },
      releasePolicy: { defectZeroSeverity: quality.zero_open_defects_severity, maximumMediumDefects: limits.medium, maximumLowDefects: limits.low, dependencySource: dependencyPolicy.artifact, dependencyAssurance: assurance },
      evidenceDigests: reportDigests,
      openDefects, artifact: { sha256: artifact.artifactDigest, sbomSha256: artifact.sbomDigest, dependencyCount: artifact.dependencyCount },
      hostedChecks: governancePolicy.required_checks.map((/** @type {{context:string,integration_id:number}} */ required) => ({ context: required.context, integrationId: required.integration_id, checkRuns: checks.filter(check => check.name === required.context && check.app?.id === required.integration_id && check.head_sha === revision).map(check => ({ id: check.id, conclusion: check.conclusion, completedAt: check.completed_at })) })),
      gateEvidence: Object.fromEntries(Object.entries(evidence.reports).map(([gate, report]) => [gate, { revision: report.revision, trustedRevision: report.trustedRevision ?? null, baseRevision: report.baseRevision ?? null, evidenceDigest: report.evidenceDigest ?? report.contractDigest, policyDigest: report.policyDigest ?? report.qualityDigest ?? report.contractDigest, results: report.results.map((/** @type {Json} */ result) => ({ capability: result.capability, status: result.status, required: result.required ?? true })) }])),
      exceptions: certificateExceptions,
      results: [{ capability: 'release-certification', required: true, status: 'passed', reason: 'All required exact-revision evidence, live GitHub checks/review/protection, defect limits, artifact bytes, and SPDX SBOM satisfy trusted release policy.' }],
    };
    if (options['--output']) {
      const destination = resolve(options['--output']); mkdirSync(dirname(destination), { recursive: true });
      if (existsSync(destination)) { const stat = lstatSync(destination); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Certificate output must be a regular file.'); }
      writeFileSync(destination, JSON.stringify(certificate, null, 2) + '\n', { flag: existsSync(destination) ? 'w' : 'wx' });
    }
    return certificate;
  } catch (error) {
    return { operation: 'certify', outcome: 'blocked', results: [{ capability: 'release-certification', required: true, status: 'failed', reason: error instanceof Error ? error.message : 'Release evidence is incomplete or unavailable.' }] };
  }
}
