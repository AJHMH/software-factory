import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { rawGit } from './coverage-evaluation.mjs';

/** @typedef {Record<string, any>} Json */
const validator = new Ajv.default({ strict: true }).compile(JSON.parse(readFileSync(new URL('../schemas/human-review-policy.schema.json', import.meta.url), 'utf8')));
const targets = [
  { file: 'factory-agent-review.yml', event: 'pull_request', name: 'Enforce Factory human approval' },
  { file: 'factory-policy.yml', event: 'pull_request_target', name: 'Enforce Factory trusted human approval' },
];
/** @param {string} path @param {string} method @returns {Promise<any>} */
async function api(path, method = 'GET') {
  if (!process.env.FACTORY_GITHUB_TOKEN) throw new Error('Authentication unavailable');
  const response = await fetch(`https://api.github.com/${path}`, { method,
    headers: { Authorization: `Bearer ${process.env.FACTORY_GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
    redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (method === 'POST') { if (response.status !== 201) throw new Error('Rerun denied'); return null; }
  if (!response.ok) throw new Error('Evidence unavailable');
  const text = await response.text(); if (text.length > 8 * 1024 * 1024) throw new Error('Evidence too large');
  return JSON.parse(text);
}
/** @param {unknown} value */
function id(value) { return Number.isSafeInteger(Number(value)) && /^[1-9][0-9]*$/.test(String(value)); }
/** @param {string} value */
function date(value) { const time = Date.parse(value); if (!Number.isFinite(time) || time > Date.now() + 60000) throw new Error('Invalid time'); return time; }
/** @param {string} prefix @returns {Promise<string>} */
async function reviewsDigest(prefix) {
  const normalized = [];
  for (let page = 1; page <= 10; page++) {
    const entries = await api(`${prefix}/reviews?per_page=100&page=${page}`);
    if (!Array.isArray(entries)) throw new Error('Review history unavailable');
    for (const review of entries) {
      if (!id(review.id) || !review.user?.login || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED', 'PENDING'].includes(review.state)) throw new Error('Malformed review');
      normalized.push([review.id, review.user.login, review.user.type, review.state, review.commit_id, review.submitted_at]);
    }
    if (entries.length < 100) return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }
  throw new Error('Review history exceeds bound');
}
/** @param {Json} pr @param {Json} expected @param {string} repository */
function checkPr(pr, expected, repository) {
  if (pr.number !== expected.pull || pr.state !== 'open' || pr.base?.ref !== 'main' || pr.head?.sha !== expected.head || pr.base?.sha !== expected.base ||
    pr.head?.repo?.full_name?.toLowerCase() !== repository.toLowerCase() || pr.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase()) throw new Error('PR changed');
}
/** @param {Json} run @param {Json} workflow @param {Json} expected @param {string} repository @param {string} event @param {string} title */
function checkRun(run, workflow, expected, repository, event, title) {
  if (!id(run.id) || run.workflow_id !== workflow.id || run.path !== workflow.path || workflow.state !== 'active' || run.event !== event ||
    run.head_sha !== expected.head || run.head_branch !== expected.branch || run.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
    run.display_title !== title) throw new Error('Run identity mismatch');
  date(run.created_at);
}

/** Refresh existing jobs only; never publish a check verdict or approve a PR. @param {Record<string,string>} options */
export async function refreshApprovals(options) {
  /** @type {Array<{runId:number,jobId:number,status:string}>} */ const requests = [];
  try {
    const repository = options['--repository'], revision = options['--trusted-revision'], mode = options['--mode'];
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(revision ?? '') || !id(options['--trigger-run']) || !['inspect', 'apply'].includes(mode)) throw new Error('Invalid request');
    const repo = resolve(options['--trusted-repo'] ?? '.');
    if (rawGit(repo, ['rev-parse', 'HEAD']).trim() !== revision) throw new Error('Evaluator checkout is not the trusted base');
    const document = parse(rawGit(repo, ['show', `${revision}:policies/human-review.yaml`]));
    if (!validator(document)) throw new Error('Invalid policy');
    const policy = /** @type {Json} */ (document).human_review;
    if (!Array.isArray(policy.human_approvers) || !policy.human_approvers.length) throw new Error('Refresh callers must be explicit');
    const prefix = `repos/${repository}`, trigger = await api(`${prefix}/actions/runs/${options['--trigger-run']}`);
    const tuple = /^factory-review-event:([1-9][0-9]*):([a-f0-9]{40}):([a-f0-9]{40}):(submitted|edited|dismissed)$/.exec(trigger.display_title ?? '');
    if (!tuple || !id(tuple[1]) || Number(trigger.id) !== Number(options['--trigger-run'])) throw new Error('Unrecognized review event');
    const expected = { pull: Number(tuple[1]), head: tuple[2], base: tuple[3], branch: trigger.head_branch };
    if (expected.base !== revision) throw new Error('Stale base');
    const observer = await api(`${prefix}/actions/workflows/factory-review-event.yml`);
    checkRun(trigger, observer, expected, repository, 'pull_request_review', tuple[0]);
    if (trigger.status !== 'completed') throw new Error('Review observer is incomplete');
    const prPath = `${prefix}/pulls/${expected.pull}`, pr = await api(prPath);
    checkPr(pr, expected, repository);
    if (pr.head.ref !== expected.branch) throw new Error('Branch identity mismatch');
    const callers = new Set(policy.human_approvers.map((/** @type {string} */ login) => login.toLowerCase()));
    const agents = new Set((policy.agent_accounts ?? []).map((/** @type {string} */ login) => login.toLowerCase()));
    for (const actor of [trigger.actor, trigger.triggering_actor]) {
      if (actor?.type !== 'User' || !/^[A-Za-z0-9-]{1,39}$/.test(actor.login ?? '') || !callers.has(actor.login.toLowerCase()) || agents.has(actor.login.toLowerCase()) || actor.login.toLowerCase() === pr.user.login.toLowerCase()) throw new Error('Unauthorized caller');
      const permission = await api(`${prefix}/collaborators/${actor.login}/permission`);
      if (!['write', 'maintain', 'admin'].includes(permission.permission)) throw new Error('Caller permission revoked');
    }
    const reviewDigest = await reviewsDigest(prPath), eventTime = date(trigger.created_at);
    if (mode === 'inspect') {
      checkPr(await api(prPath), expected, repository);
      if (await reviewsDigest(prPath) !== reviewDigest) throw new Error('Reviews changed');
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `pull_request=${expected.pull}\nbase_revision=${expected.base}\nhead_revision=${expected.head}\n`);
      return { operation: 'refresh-approvals', outcome: 'ready', ...expected, reviewDigest, requests,
        results: [{ capability: 'approval-refresh', required: true, status: 'eligible', reason: 'Authorized current-head review event; no jobs rerun and no approval granted.' }] };
    }
    const title = `factory-review:${expected.pull}:${expected.head}:${expected.base}`;
    /** @type {Array<{runId:number,jobId:number}>} */ const planned = [];
    for (const target of targets) {
      const workflow = await api(`${prefix}/actions/workflows/${target.file}`);
      const inventory = await api(`${prefix}/actions/workflows/${target.file}/runs?event=${target.event}&head_sha=${expected.head}&per_page=100`);
      if (!Array.isArray(inventory.workflow_runs) || inventory.total_count !== inventory.workflow_runs.length) throw new Error('Run inventory incomplete');
      const runs = inventory.workflow_runs.filter((/** @type {Json} */ run) => run.display_title === title && run.head_branch === expected.branch);
      if (!runs.length || runs.length > 10) throw new Error('No bounded original approval runs');
      for (const run of runs) {
        checkRun(run, workflow, expected, repository, target.event, title);
        const deadline = Date.now() + 180000;
        let job;
        while (true) {
          const data = await api(`${prefix}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
          if (!Array.isArray(data.jobs) || data.total_count !== data.jobs.length) throw new Error('Job inventory incomplete');
          const jobs = data.jobs.filter((/** @type {Json} */ entry) => entry.name === target.name);
          if (jobs.length !== 1) throw new Error('Approval job missing or ambiguous');
          job = jobs[0];
          if (!id(job.id) || job.run_id !== run.id || job.head_sha !== expected.head) throw new Error('Job identity mismatch');
          if (job.status === 'completed') break;
          if (Date.now() >= deadline) throw new Error('Approval job did not settle');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        if (['success', 'failure'].includes(job.conclusion) && job.started_at !== null && date(job.started_at) > eventTime) { requests.push({ runId: run.id, jobId: job.id, status: 'already-current' }); continue; }
        planned.push({ runId: run.id, jobId: job.id });
      }
    }
    for (const request of planned) {
      checkPr(await api(prPath), expected, repository);
      if (await reviewsDigest(prPath) !== reviewDigest) throw new Error('Reviews changed');
      for (const actor of [trigger.actor, trigger.triggering_actor]) {
        const permission = await api(`${prefix}/collaborators/${actor.login}/permission`);
        if (!['write', 'maintain', 'admin'].includes(permission.permission)) throw new Error('Caller permission revoked');
      }
      await api(`${prefix}/actions/jobs/${request.jobId}/rerun`, 'POST');
      requests.push({ ...request, status: 'requested' });
    }
    return { operation: 'refresh-approvals', outcome: planned.length ? 'requested' : 'not-required', ...expected, reviewDigest, requests,
      results: [{ capability: 'approval-refresh', required: true, status: planned.length ? 'requested' : 'not-required', reason: planned.length ?
        'Existing approval jobs refreshed; their trusted validators determine the result. No approval or bypass granted.' :
        'Original approval jobs already ran after the event; no new rerun requested and no approval granted.' }] };
  } catch {
    return { operation: 'refresh-approvals', outcome: 'blocked', requests,
      results: [{ capability: 'approval-refresh', required: true, status: 'error', reason: 'Refresh identity, authorization, freshness, or original job evidence is unavailable. No approval granted; inspect the current PR and run metadata.' }] };
  }
}
