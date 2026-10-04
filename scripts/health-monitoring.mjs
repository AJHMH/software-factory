import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, ftruncateSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

const stateVersion = 1;
const maxStateBytes = 1_048_576;
const maxObservations = 9_000;
/** @typedef {{repository?:string,workloadId?:string,stateFile?:string,evidenceOutput?:string,endpoint?:string,fixtureResult?:string,runUrl?:string,policyPath?:string}} HealthOptions */
/** @typedef {{clock?:()=>number,fetch?:typeof fetch,policy?:any,githubToken?:string}} HealthDependencies */
/** @typedef {{issueNumber:number,issueUrl:string,marker:string,openedAt:string}} Incident */
/** @typedef {{maintain:(incident:Incident)=>Promise<'active'|'reopened'>,open:(key:string,workloadId:string,endpointHost:string,openedAt:string,failureCount:number,runUrl?:string)=>Promise<Incident>,recover:(incident:Incident,recoveredAt:string,durationMinutes:number,latestStatus:string)=>Promise<{issueNumber:number,issueUrl:string}>}} IncidentAdapter */
/** @param {string} value */
const sha256 = value => createHash('sha256').update(value).digest('hex');
/** @param {()=>number} clock */
const nowIso = clock => new Date(clock()).toISOString();

/** Load policy only from the selected checkout. Production workflow runs on protected main. */
/** @param {string | undefined} [path] */
export function readOperationsPolicy(path = 'policies/operations.yaml') {
  return parse(readFileSync(path, 'utf8'));
}

/** @param {any} policy */
function validatePolicy(policy) {
  const checks = policy?.operations?.health_checks;
  const incident = policy?.operations?.incident_response;
  const metrics = policy?.operations?.observability?.metrics;
  if (checks?.frequency_minutes !== 5 ||
      !Number.isInteger(checks?.timeout_seconds) || checks.timeout_seconds < 1 || checks.timeout_seconds > 120 ||
      !Number.isInteger(checks?.consecutive_failures_for_alert) || checks.consecutive_failures_for_alert < 1 ||
      !Array.isArray(checks.expected_status_codes) || !checks.expected_status_codes.length ||
      !checks.expected_status_codes.every(/** @param {any} code */ code => Number.isInteger(code) && code >= 200 && code < 300) ||
      incident?.alert_channel !== 'github-issues' ||
      !Number.isFinite(policy?.operations?.SLOs?.target_uptime_percentage) ||
      policy.operations.SLOs.target_uptime_percentage <= 0 || policy.operations.SLOs.target_uptime_percentage > 100 ||
      !Number.isInteger(policy.operations.SLOs.window_days) || policy.operations.SLOs.window_days < 1 || policy.operations.SLOs.window_days > 30 ||
      !Number.isFinite(policy.operations.SLOs.target_mttr_minutes) || policy.operations.SLOs.target_mttr_minutes < 1 ||
      metrics?.uptime?.numerator !== 'successful_health_probes' || metrics?.uptime?.denominator !== 'completed_health_probes' ||
      metrics?.mttr?.start_event !== 'incident_opened' || metrics?.mttr?.end_event !== 'incident_recovered' ||
      !Array.isArray(metrics?.unsupported) || !metrics.unsupported.every(/** @param {any} item */ item => typeof item === 'string')) {
    throw new Error('Operations policy is incomplete or uses an unsupported monitoring/alert adapter.');
  }
  return { checks, incident, metrics, slos: policy.operations.SLOs };
}

/** @param {string | undefined} value */
function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('FACTORY_HEALTH_ENDPOINT is required and must be an HTTPS URL.');
  let endpoint;
  try { endpoint = new URL(value); } catch { throw new Error('FACTORY_HEALTH_ENDPOINT is required and must be an HTTPS URL.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('FACTORY_HEALTH_ENDPOINT must use HTTPS and cannot contain credentials, query parameters, or a fragment.');
  }
  return endpoint;
}

/** @param {any} state @param {string} key */
function validateState(state, key) {
  if (!state || state.version !== stateVersion || state.key !== key || !Array.isArray(state.observations) ||
      state.observations.length > maxObservations ||
      !state.observations.every(/** @param {any} item */ item => Number.isFinite(item.at) && item.at <= Date.now() && ['healthy', 'failed', 'timeout'].includes(item.status) && Number.isFinite(item.durationMs) && item.durationMs >= 0) ||
      !(state.incident === null || (state.incident && Number.isInteger(state.incident.issueNumber) && state.incident.issueNumber > 0 && typeof state.incident.openedAt === 'string' && Number.isFinite(Date.parse(state.incident.openedAt)) && typeof state.incident.issueUrl === 'string' && (state.incident.marker === undefined || typeof state.incident.marker === 'string'))) ||
      !Number.isSafeInteger(state.consecutiveFailures ?? 0) || (state.consecutiveFailures ?? 0) < 0 ||
      !(state.completedIncidents === undefined || Array.isArray(state.completedIncidents) && state.completedIncidents.every(/** @param {any} item */ item => Number.isFinite(item.durationMinutes) && item.durationMinutes >= 0 && Number.isFinite(item.recoveredAt)))) {
    throw new Error('Health state is invalid or belongs to a different endpoint/workload. Resolve the incident and reset the retained state artifact explicitly.');
  }
  return state;
}

/** @param {string} path @param {string} key @param {number} at @param {number} windowDays */
function readState(path, key, at, windowDays) {
  if (!existsSync(path)) return { version: stateVersion, key, observations: [], incident: null };
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > maxStateBytes) throw new Error('Health state must be a small, singly linked regular file.');
  const state = validateState(JSON.parse(readFileSync(path, 'utf8')), key);
  const cutoff = at - windowDays * 24 * 60 * 60 * 1000;
  state.observations = state.observations.filter(/** @param {any} item */ item => item.at >= cutoff);
  state.completedIncidents = (state.completedIncidents ?? []).filter(/** @param {any} item */ item => Number.isFinite(item.recoveredAt) && item.recoveredAt >= cutoff);
  return state;
}

/** @param {string | undefined} path @param {any} value */
function saveJson(path, value) {
  if (!path) return;
  const output = resolve(path);
  mkdirSync(dirname(output), { recursive: true });
  if (existsSync(output)) {
    const metadata = lstatSync(output);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw new Error('Health output must be a singly linked regular file.');
  }
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > maxStateBytes) throw new Error('Health output exceeds the one MiB limit.');
  const flags = constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(output, flags, 0o600);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1) throw new Error('Health output must be a singly linked regular file.');
    ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, bytes);
  } finally { closeSync(descriptor); }
}

/** @param {URL} endpoint @param {number} timeoutSeconds @param {number[]} expectedStatusCodes @param {typeof fetch} fetchImpl @param {()=>number} clock */
async function probeEndpoint(endpoint, timeoutSeconds, expectedStatusCodes, fetchImpl, clock) {
  const started = clock();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetchImpl(endpoint, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.1' } });
    const durationMs = Math.max(0, clock() - started);
    const status = expectedStatusCodes.includes(response.status) ? 'healthy' : 'failed';
    await response.body?.cancel();
    return { status, httpStatus: response.status, durationMs };
  } catch (error) {
    const durationMs = Math.max(0, clock() - started);
    return { status: error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError') ? 'timeout' : 'failed', httpStatus: null, durationMs };
  } finally { clearTimeout(timer); }
}

/** @param {string} repository @param {string | undefined} token @param {typeof fetch} fetchImpl */
function githubClient(repository, token, fetchImpl) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || typeof token !== 'string' || !token) {
    throw new Error('GitHub repository and GITHUB_TOKEN are required for incident tracking.');
  }
  return /** @param {string} path @param {string} [method] @param {any} [body] */ async (path, method = 'GET', body) => {
    const url = path.startsWith('https://') ? path : `https://api.github.com/repos/${repository}/${path}`;
    const response = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(10_000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(response.status === 403 ? 'GitHub denied incident tracking; grant this workflow issues: write.' : `GitHub incident tracking failed with HTTP ${response.status}.`);
    return response.status === 204 ? null : response.json();
  };
}

/** @param {(path:string,method?:string,body?:any)=>Promise<any>} api @param {string} repository @param {string} marker */
async function findIncident(api, repository, marker) {
  for (let page = 1; page <= 10; page++) {
    const issues = await api(`https://api.github.com/repos/${repository}/issues?state=open&per_page=100&page=${page}`);
    const match = issues.find(/** @param {any} item */ item => !item.pull_request && item.body?.includes(marker));
    if (match) return match;
    if (issues.length < 100) return null;
  }
  throw new Error('Incident lookup exceeded 1,000 open issues; refusing to risk a duplicate alert.');
}

/** @param {string} repository @param {string | undefined} token @param {typeof fetch} fetchImpl @returns {IncidentAdapter} */
function githubIncidentAdapter(repository, token, fetchImpl) {
  const api = githubClient(repository, token, fetchImpl);
  return {
    async maintain(incident) {
      const issue = await api(`https://api.github.com/repos/${repository}/issues/${incident.issueNumber}`);
      if (!issue.body?.includes(incident.marker)) throw new Error('Tracked incident identity does not match its retained state.');
      if (issue.state === 'closed') {
        await api(`https://api.github.com/repos/${repository}/issues/${incident.issueNumber}`, 'PATCH', { state: 'open' });
        return 'reopened';
      }
      return 'active';
    },
    async open(key, workloadId, endpointHost, openedAt, failureCount, runUrl) {
      const marker = `<!-- factory-health-incident:v1:${key} -->`;
      const found = await findIncident(api, repository, marker);
      if (found) return { issueNumber: found.number, issueUrl: found.html_url, marker, openedAt: found.created_at };
      const created = await api(`https://api.github.com/repos/${repository}/issues`, 'POST', {
        title: `[Factory Health] ${workloadId} is unhealthy`,
        body: `${marker}\n## Health incident\n\nThe configured endpoint for **${workloadId}** failed ${failureCount} consecutive checks.\n\n- Endpoint host: \`${endpointHost}\`\n- Incident detected: ${openedAt}\n- Workflow evidence: ${runUrl || 'not available'}\n\nThis issue is the configured GitHub incident alert. Recovery will be recorded here when the endpoint meets policy again.`,
      });
      return { issueNumber: created.number, issueUrl: created.html_url, marker, openedAt: created.created_at };
    },
    async recover(incident, recoveredAt, durationMinutes, latestStatus) {
      const issue = await api(`https://api.github.com/repos/${repository}/issues/${incident.issueNumber}`);
      if (!issue.body?.includes(incident.marker)) throw new Error('Tracked incident identity does not match its retained state.');
      const recoveryMarker = `<!-- factory-health-recovered:v1:${sha256(`${incident.marker}:${incident.openedAt}`)} -->`;
      const comments = await api(`https://api.github.com/repos/${repository}/issues/${incident.issueNumber}/comments?per_page=100&sort=created&direction=desc`);
      if (!comments.some(/** @param {any} comment */ comment => comment.body?.includes(recoveryMarker))) {
        await api(`https://api.github.com/repos/${repository}/issues/${incident.issueNumber}/comments`, 'POST', {
          body: `${recoveryMarker}\n## Recovery confirmed\n\nThe endpoint returned to a policy-accepted status at ${recoveredAt}. The incident lasted ${durationMinutes} minutes; latest probe status: ${latestStatus}.\n\nThis is a monitoring recovery notification only. It does not perform or authorize a deployment rollback.`,
        });
      }
      if (issue.state !== 'closed') await api(`https://api.github.com/repos/${repository}/issues/${incident.issueNumber}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
      return { issueNumber: incident.issueNumber, issueUrl: issue.html_url };
    },
  };
}

/** @param {any} state @param {string} repository @returns {IncidentAdapter} */
function fixtureIncidentAdapter(state, repository) {
  return {
    async maintain() { return 'active'; },
    async open(key, workloadId, endpointHost, openedAt, failureCount) {
      if (state.fixtureIncident?.key === key && state.fixtureIncident.status === 'open') return state.fixtureIncident;
      const incident = { issueNumber: (state.fixtureIssueSequence ?? 0) + 1, issueUrl: `https://github.com/${repository}/issues/fixture`, marker: `fixture:${key}`, openedAt, status: 'open', workloadId, endpointHost, failureCount };
      state.fixtureIssueSequence = incident.issueNumber;
      state.fixtureIncident = incident;
      state.fixtureNotifications ??= [];
      state.fixtureNotifications.push({ type: 'incident_opened', at: openedAt, issueNumber: incident.issueNumber });
      return incident;
    },
    async recover(incident, recoveredAt, durationMinutes, latestStatus) {
      const current = state.fixtureIncident;
      if (current?.status !== 'closed') {
        if (current) { current.status = 'closed'; current.recoveredAt = recoveredAt; }
        state.fixtureNotifications ??= [];
        state.fixtureNotifications.push({ type: 'incident_recovered', at: recoveredAt, issueNumber: incident.issueNumber, durationMinutes, latestStatus });
      }
      return { issueNumber: incident.issueNumber, issueUrl: incident.issueUrl };
    },
  };
}

/** @param {any} state @param {any} slos @param {string[]} unsupported @param {number} now */
function summarizeMetrics(state, slos, unsupported, now) {
  const successful = state.observations.filter(/** @param {any} item */ item => item.status === 'healthy').length;
  const total = state.observations.length;
  const availability = total ? Number((successful / total * 100).toFixed(4)) : null;
  const oldestObservation = total ? state.observations.reduce((/** @type {number} */ oldest, /** @type {any} */ item) => Math.min(oldest, item.at), Number.POSITIVE_INFINITY) : now;
  const observedDays = total ? Math.min(slos.window_days, Math.max(0, (now - oldestObservation) / 86400000)) : 0;
  const windowComplete = observedDays >= slos.window_days;
  const completedIncidents = state.completedIncidents ?? [];
  const mttrMinutes = completedIncidents.length ? Number((completedIncidents.reduce((/** @type {number} */ sum, /** @type {any} */ item) => sum + item.durationMinutes, 0) / completedIncidents.length).toFixed(2)) : null;
  return {
    windowDays: slos.window_days,
    availability: { valuePercentage: availability, targetPercentage: slos.target_uptime_percentage, status: availability === null ? 'unavailable' : !windowComplete ? 'provisional' : availability >= slos.target_uptime_percentage ? 'meeting' : 'breached', observedDays: Number(observedDays.toFixed(2)), successfulProbes: successful, completedProbes: total, semantics: 'Successful probes divided by all completed probes in the rolling policy window; time before the first observation and scheduler delays are excluded. Status remains provisional until a full policy window has been observed.' },
    mttr: { valueMinutes: mttrMinutes, targetMinutes: slos.target_mttr_minutes, status: mttrMinutes === null ? 'unavailable' : mttrMinutes <= slos.target_mttr_minutes ? 'meeting' : 'breached', completedIncidents: completedIncidents.length, semantics: 'Mean elapsed time from GitHub incident issue creation to confirmed recovery and issue closure.' },
    unsupported: unsupported.map(/** @param {string} name */ name => ({ name, status: 'unsupported', reason: 'No authoritative, workload-linked data source is configured for this metric.' })),
  };
}

/** @param {HealthOptions} options @param {HealthDependencies} [dependencies] */
export async function monitorHealth(options, dependencies = {}) {
  const clock = dependencies.clock ?? Date.now;
  const fetchImpl = dependencies.fetch ?? fetch;
  const fixtureResult = options.fixtureResult;
  const at = clock();
  let endpoint;
  let state;
  let report;
  try {
    const policy = validatePolicy(dependencies.policy ?? readOperationsPolicy(options.policyPath));
    const repository = options.repository ?? '';
    const workloadId = options.workloadId ?? '';
    const stateFile = options.stateFile ?? '';
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(workloadId) || !stateFile) throw new Error('Repository, workload ID, and retained state file are required.');
    if (options.evidenceOutput && resolve(options.evidenceOutput) === resolve(stateFile)) throw new Error('Health state and evidence must use separate output files.');
    if (fixtureResult && !['healthy', 'failed', 'timeout'].includes(fixtureResult)) throw new Error('Fixture result must be healthy, failed, or timeout.');
    endpoint = fixtureResult ? new URL(options.endpoint ?? 'https://fixture.invalid/health') : validateEndpoint(options.endpoint ?? process.env.FACTORY_HEALTH_ENDPOINT);
    const key = sha256(`${repository.toLowerCase()}\n${workloadId}\n${endpoint.href}`);
    state = readState(resolve(stateFile), key, at, policy.slos.window_days);
    let probe;
    if (fixtureResult) probe = { status: fixtureResult, httpStatus: fixtureResult === 'healthy' ? 200 : fixtureResult === 'failed' ? 503 : null, durationMs: fixtureResult === 'timeout' ? policy.checks.timeout_seconds * 1000 : 4 };
    else probe = await probeEndpoint(endpoint, policy.checks.timeout_seconds, policy.checks.expected_status_codes, fetchImpl, clock);
    const observedAt = nowIso(clock);
    state.observations.push({ at, status: probe.status, durationMs: probe.durationMs });
    state.observations = state.observations.slice(-maxObservations);
    const failed = probe.status !== 'healthy';
    let incidentAction = 'none';
    let incidentLink;
    if (failed) {
      state.consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
      if (!state.incident && state.consecutiveFailures >= policy.checks.consecutive_failures_for_alert) {
        const adapter = fixtureResult ? fixtureIncidentAdapter(state, repository) : githubIncidentAdapter(repository, dependencies.githubToken ?? process.env.GITHUB_TOKEN, fetchImpl);
        const incident = await adapter.open(key, workloadId, endpoint.host, observedAt, state.consecutiveFailures, options.runUrl ?? process.env.GITHUB_RUN_URL);
        state.incident = { issueNumber: incident.issueNumber, issueUrl: incident.issueUrl, marker: incident.marker, openedAt: incident.openedAt ?? observedAt };
        state.incidentKey = key;
        incidentAction = 'opened'; incidentLink = incident.issueUrl;
      } else if (state.incident) {
        const adapter = fixtureResult ? fixtureIncidentAdapter(state, repository) : githubIncidentAdapter(repository, dependencies.githubToken ?? process.env.GITHUB_TOKEN, fetchImpl);
        incidentAction = (await adapter.maintain(state.incident)) === 'reopened' ? 'reopened' : 'none';
        incidentLink = state.incident.issueUrl;
      }
    } else {
      state.consecutiveFailures = 0;
      if (state.incident) {
        const durationMinutes = Math.max(0, Number(((at - Date.parse(state.incident.openedAt)) / 60000).toFixed(2)));
        const incidentData = { ...state.incident, marker: state.incident.marker ?? `<!-- factory-health-incident:v1:${state.incidentKey ?? key} -->` };
        const adapter = fixtureResult ? fixtureIncidentAdapter(state, repository) : githubIncidentAdapter(repository, dependencies.githubToken ?? process.env.GITHUB_TOKEN, fetchImpl);
        const closed = await adapter.recover(incidentData, observedAt, durationMinutes, probe.status);
        state.completedIncidents ??= [];
        state.completedIncidents.push({ durationMinutes, recoveredAt: at });
        state.completedIncidents = state.completedIncidents.slice(-1000);
        state.incident = null; state.incidentKey = null;
        incidentAction = 'recovered'; incidentLink = closed.issueUrl;
      }
    }
    const metrics = summarizeMetrics(state, policy.slos, policy.metrics.unsupported, at);
    const healthStatus = failed ? 'failed' : 'passed';
    report = {
      operation: 'health-monitoring', outcome: failed ? 'failed' : 'passed', simulated: Boolean(fixtureResult),
      results: [{ capability: 'health-monitoring', status: healthStatus, required: true, reason: failed ? `Endpoint probe ${probe.status}; ${state.consecutiveFailures} consecutive failure(s), alert threshold ${policy.checks.consecutive_failures_for_alert}.` : 'Endpoint returned a policy-accepted status.' }],
      evidence: { repository, workloadId, endpointHost: endpoint.host, endpointDigest: key, observedAt, probe, consecutiveFailures: state.consecutiveFailures, incidentAction, ...(incidentLink ? { incidentUrl: incidentLink } : {}), metrics },
    };
    saveJson(stateFile, state);
  } catch (error) {
    report = { operation: 'health-monitoring', outcome: 'blocked', simulated: Boolean(fixtureResult), results: [{ capability: 'health-monitoring', status: 'error', required: true, reason: error instanceof Error ? error.message : 'Health monitoring failed closed.' }] };
    if (state && options.stateFile) { try { saveJson(options.stateFile, state); } catch { /* Preserve the primary fail-closed report. */ } }
  }
  if (options.evidenceOutput && (!options.stateFile || resolve(options.evidenceOutput) !== resolve(options.stateFile))) saveJson(options.evidenceOutput, { schemaVersion: 1, ...report });
  return report;
}
