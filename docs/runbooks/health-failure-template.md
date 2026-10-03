# Runbook: Generic Health Check Failure

## Implementation status
Automated monitoring and recovery are disabled. This is a future runbook template,
not an executable recovery procedure. A human must verify deployment and migration
compatibility before taking recovery action.

## Scenario
The application's `health_endpoint` has returned a non-200 status code or timed out consecutively, breaching the threshold defined in `policies/operations.yaml`.

## Automatic Remediation (Operations Agent)
1. **Verify Metrics:** Check if this is an isolated incident or correlated with a spike in error rates or latency.
2. **Determine Scope:** Identify if a recent deployment occurred within the last `auto_rollback_threshold.duration_minutes`.
3. **Execute Rollback:** Once rollback is implemented and authorized, restore the previous compatible deployed artifact and verify recovery. Do not reset or rewrite the main branch; source corrections require a separate reviewed change.
4. **Trigger Fix:** If not a deployment issue, dispatch a `trigger-remediation` event to the Coding Agent with the health endpoint logs.

## Manual Escalation (Human SRE)
If the Operations Agent fails to restore health within 15 minutes, human intervention is required:
1. Check the cloud provider's status page.
2. Verify database connection pools and memory usage.
3. Review the recent agent actions in the `audit` logs.
