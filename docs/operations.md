# Operations & Runbooks

## Implementation status
The health workflow probes one explicitly configured HTTPS endpoint every five
minutes on a best-effort GitHub Actions schedule. It applies the timeout, expected
status codes, and consecutive-failure threshold in `policies/operations.yaml`.
After the threshold, it opens or reuses one GitHub issue for the endpoint and closes
it with a recovery notification when checks pass again. State and evidence artifacts
are retained for 90 days. GitHub's scheduler can delay or skip runs, so this is not a
hard real-time monitoring guarantee. External paging, automatic rollback, and
remediation remain disabled; see [capabilities](capabilities.md) and ticket #18.

Before enabling monitoring, set repository Actions variable
`FACTORY_HEALTH_ENDPOINT` to the deployed workload's HTTPS health URL. The value
must not contain URL credentials, a query string, or a fragment, and must respond
without authentication; authenticated endpoints and custom request headers are not
supported yet. This workflow supports one endpoint per repository. Optionally set
`FACTORY_WORKLOAD_ID` to a stable identifier; the default is
`factory-reference-workload`. The Actions token needs `actions: read` to restore
prior state and `issues: write` to create and close incidents. Missing endpoint
configuration fails the check rather than reporting healthy.
If the endpoint or workload ID changes, resolve any open incident for the old target
and delete the latest `factory-health-state` workflow artifact before the next check;
the retained state is deliberately bound to the exact configuration.

## Health evidence and operational metrics
Each completed probe records its time, endpoint digest/host, status, duration,
consecutive failure count, incident transition, and policy-derived metrics. Full
check and state artifacts are retained for 90 days. The rolling uptime SLI is
successful probes divided by completed probes during the configured SLO window;
timeouts and unexpected status codes count as failures. Time before the first
observation and scheduler delays are excluded, so the SLI is probe-based and does
not claim continuous availability. It stays provisional until a full SLO window has
been observed; before then, the sample ratio is reported without claiming the target
is met.

MTTR is the mean elapsed time from a GitHub incident issue's creation to its
confirmed recovery and closure. Lead time, deployment frequency, and change failure
rate remain explicitly unsupported because no authoritative workload-linked
deployment/change data source is configured. The monitor does not invent values for
those metrics. GitHub Issues are the configured notification channel; they are not
an external pager.

## Topology
The Factory probes the configured deployed workload endpoint from GitHub-hosted
Actions. It does not run the local reference package as if it were a deployed
service.

## Incident Response
1. **Detection:** The `Factory Health Checks` workflow records endpoint probe outcomes.
2. **Triage:** After the configured consecutive-failure threshold, it opens or reuses the single matching GitHub incident issue.
3. **Recovery:** A passing probe closes the active incident with a recovery comment and measured incident duration.
4. **Escalation:** A human investigates and follows the runbook. The workflow does not page, roll back, or dispatch remediation; those actions require separate implementation and authorization.
