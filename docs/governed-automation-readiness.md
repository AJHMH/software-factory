# Governed Automation readiness

Ticket #20 assessment, updated 2026-10-09: **incomplete**. Implementation and controlled
demonstrations are available; this is not a production certification or compliance
claim. The following evidence is historical and revision-bound. Re-run the
demonstration and obtain fresh GitHub evidence before making a readiness decision.

## Reproduce the integrated demonstration

Use a reviewed, trusted Factory checkout, Node 24, Git and installed dependencies.
Run `npm ci`, `npm run typecheck`, then:

```powershell
node scripts/factory-validation.mjs readiness --mode inspect
node scripts/factory-validation.mjs readiness --mode demonstrate > readiness.json
```

`inspect` lists scenarios without running them. Its gap assessment is dated,
not a live GitHub query. `demonstrate` runs a fixed set of
public CLI scenario suites; it accepts no custom executable, provider, fixture,
policy override or credential arguments. Run from a host that allows isolated Git
fixtures and process termination. Each suite has a three-minute timeout. Exit 0
means the controlled demonstration passed; exit 1 means execution failed or lacked
a complete passing summary. **Neither exit code authorizes a release.** The JSON
retains `readiness: incomplete` even when `outcome: passed`.

Reports record source revision, working-tree dirtiness, execution times,
suite references, passing/failing/skipped counts and SHA-256
digests of test output. Raw output is discarded. The child environment excludes
API credentials, signing variables, Node preloads and Actions output paths.
Use the named `node --test tests/<name>.test.mjs` command for local diagnostics;
keep raw diagnostics private and inspect them before sharing. A digest identifies
an execution output, but does not sign it or authenticate its origin. A dirty
checkout is development evidence; the source commit does not identify its changes.

## Evidence boundaries and scenario coverage

| Scenario / public operation | Reproducible evidence | Boundary |
| --- | --- | --- |
| Reference/consumer validation, incompatible adoption, failed commands, upgrade and recovery (`distribution`) | `tests/factory-distribution.test.mjs` | Real isolated Git repositories and local commands; hosted evidence below |
| Delivery error redaction (`release-artifact`) | `tests/readiness.test.mjs` | Missing private artifact path is absent from public report; raw unexpected diagnostics are discarded |
| Candidate weakening of trusted policy (`policy`) | `tests/policy-evaluation.test.mjs` | Trusted versus candidate committed policies |
| Missing/unauthorized/dismissed review and stale evidence (`human-review`) | `tests/human-review.test.mjs` | Controlled review evidence; GitHub collector responses are fixtures |
| Vulnerability thresholds, secret exceptions, stale/missing scanner evidence (`security`) | `tests/security.test.mjs` | Controlled reports; two real scanner integrations are skipped by default |
| Bounded remediation, unauthorized callers, exact proposal approval and replay (`remediate`, `local-remediate`) | `tests/remediation.test.mjs` | Isolated Git/file operations; PR publication API is a fixture |
| Prompt/tool/path denials, budgets, deadline, cancellation, redaction and expiry (`propose-change`, `prune-agent-evidence`) | `tests/agent-runner.test.mjs` | Synthetic adapter cost; real private workspace and retention cleanup |
| Approved patch merge, stale/spoofed checks, major/manual changes (`dependencies`) | `tests/dependencies.test.mjs` | GitHub mutation endpoints are fixtures |
| Certified release preparation, invalid provenance/digests/tags denied (`release --mode prepare`) | `tests/release-management.test.mjs` | Synthetic certificate/run evidence; no live publication or OIDC signature |
| Approved package promotion and denials (`promote`) | `tests/artifact-promotion.test.mjs` | Filesystem reference adapter; controlled Environment evidence |
| Probe failure, deduplication, recovery, incident permissions (`health-monitoring`) | `tests/health-monitoring.test.mjs` | Controlled endpoints and GitHub issue API; no paging guarantee |
| Restoration, migration denial, corrupt bytes, escalation, loop prevention (`rollback`) | `tests/artifact-rollback.test.mjs` | Real local package bytes and reference pointer; no running-service recovery |

The scanner integrations can be run separately with
`FACTORY_SECURITY_INTEGRATION=1` and the verified pinned scanner installation;
see [security enforcement](security-enforcement.md). Record tool versions,
revision, conclusion and skipped counts. Synthetic severity reports prove policy
decisions, not vulnerability discovery. No claim of real scanner execution follows
from a skipped test or policy configuration.

## Observed GitHub evidence

| Observation | Evidence / exact source |
| --- | --- |
| Factory main validation succeeded | [run 37248046116](https://github.com/AJHMH/software-factory/actions/runs/37248046116), `7b61dcdbba263e76c32da106c2f3b07ebf9d79f2` |
| Consumer main validation succeeded | [run 37249509549](https://github.com/AJHMH/developer-agentic-os/actions/runs/37249509549), `5efbdcaa42cf4a63cf2322f714311b276af420ca`; certification skipped |
| Unsupported consumer version denied before commands | [run 37246377833](https://github.com/AJHMH/developer-agentic-os/actions/runs/37246377833) |
| Consumer exit-7 command denied packaging | [run 37246391735](https://github.com/AJHMH/developer-agentic-os/actions/runs/37246391735) |
| Consumer recovery passed | [run 37246417644](https://github.com/AJHMH/developer-agentic-os/actions/runs/37246417644) |
| Ineligible certification producer denied | [run 37246417710](https://github.com/AJHMH/developer-agentic-os/actions/runs/37246417710); temporary probe removed |
| Weakened timeout policy denied | [run 37144523856](https://github.com/AJHMH/software-factory/actions/runs/37144523856), PR #23; historical denial |
| Missing human review denied | [run 37157111221](https://github.com/AJHMH/software-factory/actions/runs/37157111221), PR #26; historical denial |
| Coverage decrease denied | [run 37157226374](https://github.com/AJHMH/software-factory/actions/runs/37157226374), PR #26; historical denial |

Live API reads on 2026-10-09 returned **zero GitHub Releases and zero Deployments**
for `AJHMH/software-factory`. Recheck with `gh api repos/AJHMH/software-factory/releases`
and `gh api repos/AJHMH/software-factory/deployments`. Consequently this report
does not demonstrate successful hosted signed publication, protected promotion,
live monitoring of a promoted runtime, or incident-driven runtime recovery.

Local validation on 2026-10-04 also executed both real pinned-scanner integration
tests successfully: generated dummy-secret denial and known-vulnerable locked
dependency denial. These results establish scanner behavior for the isolated test
fixtures, not cleanliness of the consumer application or a new release.

## Readiness gaps and decision

- Obtain an authorized certification, signed release and protected reference
  promotion. Preserve source SHA, producer/certificate run IDs, asset digests,
  verified attestations, current human/Environment approvals and deployment receipt.
  Follow the linked procedures; this demonstration never dispatches these mutations.
- Demonstrate delivery-evidence expiry on the actual hosted retention boundary.
  Agent cleanup tests prove removal of expired private workspace details while
  preserving cost/replay reservations. They do not establish remote retention,
  legal erasure, artifact expiry or third-party storage compliance.
- Running-service rollback, a production provider, arbitrary agent tools and
  unrestricted autonomy remain unsupported or outside scope. Package restoration
  cannot be reported as recovered service availability.

The owner decides readiness using these observations and gaps. A green test run,
available capability, configured retention period or synthetic certificate is
insufficient to remove any hosted-evidence gap. Record fresh evidence and review
the report whenever a gap is resolved; do not silently promote fixture evidence.

See the [operator guide](OPERATING_MODEL.md), [capability guide](capabilities.md)
and [ADR 006](adrs/006-readiness-evidence-boundaries.md).

## Resolved live gaps (2026-10-09)

Second-consumer certification (#49) succeeded for the owner-selected replacement
`AJHMH/profile-page`: [main producer](https://github.com/AJHMH/profile-page/actions/runs/37984671333)
and [hosted certificate, attempt 2](https://github.com/AJHMH/profile-page/actions/runs/37985441486/attempts/2)
bind source `b950db04678150a8792f18c2f96c4716c0770fa4` to reviewed head
`ddc763152389f540dccc509e068e0072a511f897` and Factory pin
`011e83014d666b782d9eee97c16c6bcf2cecc996`. See the
[consumer runbook](consumer-certification.md#verified-replacement-consumer-2026-10-09)
for downloaded certificate, package and SPDX SBOM digests. Deleted-consumer links
in the earlier table are historical evidence only. The SvelteKit application is
outside this isolated module's certificate.

Scheduled governance (#31) has genuine successful schedule-event evidence in
[Factory production](https://github.com/AJHMH/software-factory/actions/runs/37944223538)
and [integration](https://github.com/AJHMH/software-factory-governance-integration/actions/runs/37944089810),
both with no drift and policy digest
`6ba6ed5c1e650bd3dc7f0479e4924bf37ca672977eb7b1e23e970aa18267ec76`.

Overall readiness remains incomplete: fresh API reads still find zero Factory
Releases and Deployments, and actual hosted delivery-retention expiry is unobserved.
The CLI inspection's 2026-10-04 gap snapshot is historical, not a live assessment.