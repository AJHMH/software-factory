# Deployment rollback

Use `rollback` through Factory Validation for a retained filesystem reference
package. This adapter changes the active package identity in `current.json` and
verifies the prior package bytes. It cannot recover a running service, execute or
reverse database migrations, or claim endpoint recovery. The health workflow
continues to open GitHub incidents; automatic rollback remains disabled.

## Collect and correlate

Keep the environment state outside the source repository. Retain `current.json`
and both release directories, including their promotion receipts, certificate,
manifest, workload module, and SBOM. If the package was promoted in GitHub Actions,
download the retained reference package artifacts and obtain their deployment
receipts from the GitHub deployment records. Verify the producer, environment,
source revision, and attestations before using downloaded evidence. Do not infer
package presence from a GitHub deployment record: artifacts expire after 90 days.
Reconstructing local state from those records is an operator task; the rollback
command does not download or authenticate GitHub artifacts.

Run monitoring against the workload actually associated with that deployment:

```powershell
node scripts/factory-validation.mjs health-monitoring --repository owner/repo --workload-id service --state-file C:/factory/health-state.json --evidence-output C:/factory/health-evidence.json --deployment-receipt C:/factory/reference/releases/v1.0.1/promotion-receipt.json
```

Configure `FACTORY_HEALTH_ENDPOINT` first. The receipt option binds the report to
the environment, deployment ID, artifact digest, and source revision. A new
deployment resets the consecutive-failure count. Simulation evidence cannot
authorize rollback. A health report must follow the deployment, be no more than
five minutes old, and meet the three-failure threshold in trusted rollback policy.
Error-rate triggers are unsupported because the monitor has no authoritative
error-rate source; escalate those incidents rather than inventing a health report.

## Inspect and restore

Use an authorized actor from trusted release policy and a full trusted commit SHA:

```powershell
node scripts/factory-validation.mjs rollback --mode evaluate --repository owner/repo --actor aaron-howard --trusted-repo . --trusted-revision <SHA> --environment reference --state-directory C:/factory/reference --deployment-receipt C:/factory/reference/releases/v1.0.1/promotion-receipt.json --health-evidence C:/factory/health-evidence.json
```

`eligible` means the retained previous package passed integrity, certification,
identity, migration, and freshness checks. Repeat with `--mode apply` to restore it.
Only `none` migrations with explicit compatibility are allowed. Restoration shares
the promotion lock and records an attempt before switching the package pointer.
The one-attempt limit survives process interruption. Source history is never
rewritten, and packages are never rebuilt. The report records restored identity,
verification checks, duration, outcome, and fixed redacted reason codes. Save the
CLI JSON report with the incident evidence. Successful restoration retains
`rollback-<deployment-id>.json` alongside environment state.

## Escalate

An `escalated` outcome exits 1 and identifies this runbook. Stop automation and
keep the incident open. Preserve the report, current package, attempt record,
deployment receipts, and health evidence. Check `packageSwitched` before deciding
which package is active. A failed verification after switching leaves the attempted
package selected and requires operator investigation; it never rolls forward
automatically or starts another rollback.

Investigate incompatible or unknown migrations with the migration owner; missing
or expired artifacts with the release owner; unsupported runtime adapters with the
operations owner; integrity or recovery failures with the security/operations
owner. Resolve lock contention by checking the active promotion/rollback process.
Do not remove an attempt record to retry an interrupted restoration. The default
60-second deadline includes evidence verification and pointer restoration; a breach
escalates and never reports recovery success. Re-establish a known stable package
through the approved promotion process after the incident has been investigated.
Use the existing GitHub incident for human escalation; this local command does not
send notifications, close incidents, or write GitHub Deployment status records.
