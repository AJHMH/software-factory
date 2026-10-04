# Runbook: Generic Health Check Failure

## Implementation status
The health workflow probes the configured HTTPS endpoint and opens a GitHub incident
after the policy failure threshold. On recovery it records a notification and closes
that issue. A human must verify deployment and migration compatibility before taking
recovery action; automatic rollback and external paging are not implemented.

## Scenario
The endpoint configured in repository Actions variable `FACTORY_HEALTH_ENDPOINT` has
returned an unexpected status or timed out consecutively, breaching the threshold in
`policies/operations.yaml`. GitHub scheduling is best effort and may delay checks.

## Automatic Remediation (Operations Agent)
1. **Verify the endpoint:** Open the retained health evidence artifact and confirm status, response time, and consecutive-failure count.
2. **Determine scope:** Review recent GitHub deployments and relevant workload changes; correlate them manually because change-failure metrics are not yet supported.
3. **Recover safely:** Ticket #18 will define and authorize rollback. Until then, a human must select a compatible prior release and use the approved deployment process. Do not reset or rewrite the main branch; source corrections require a separate reviewed change.
4. **Confirm recovery:** A passing probe records the recovery comment and closes the incident. If it remains open, inspect the workflow's GitHub issue permission and latest run evidence.

## Manual Escalation (Human SRE)
If the Operations Agent fails to restore health within 15 minutes, human intervention is required:
1. Check the cloud provider's status page.
2. Verify database connection pools and memory usage.
3. Review the recent agent actions in the `audit` logs.
