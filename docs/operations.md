# Operations & Runbooks

## Implementation status
Endpoint monitoring, incident reporting, remediation, paging, deployment, and
rollback are disabled. The workflow reports unsupported status without checking a
deployed endpoint. The procedures below describe the intended operating model.
See [capabilities](capabilities.md) before relying on any automated recovery.

## Topology
The Factory orchestrates workloads across environments (dev, staging, production). Agents monitor the `health_endpoint` of each active workload.

## Incident Response
1. **Detection:** The Operations Agent detects a health check failure or an SLO breach via telemetry.
2. **Triage:** The agent opens an incident issue in the repository.
3. **Remediation:** If the `trigger_remediation_agent` policy is enabled, the agent attempts to rollback the deployment or dispatch the Coding Agent to hotfix the issue.
4. **Escalation:** If the agent cannot resolve the issue within the configured timeout, a human is paged via the designated alert channel.
