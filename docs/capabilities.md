# Factory capability inventory and operator guide

## Status and guarantees

The implemented capability is truthful, read-only readiness reporting. The Factory
does not yet execute or certify workload gates. Every workload capability below is
unsupported, and optional mutation paths are disabled. This is the safe baseline
delivered by issue #2, not a Governed Automation readiness claim.

The public interface is `node scripts/factory-validation.mjs`:

- `inventory` reports all capabilities and exits 0; it does not approve delivery.
- `capability <name>` reports an optional capability and exits 0 with an
  `unsupported` outcome. No action is performed and no gate has passed.
- `capability <name> --required` reports the unsupported capability and exits 1.
- `certify` reports all mandatory release capabilities and always exits 1 with a
  `blocked` outcome. There is no publication or deployment step.
- Unknown commands, names, flags, or extra arguments exit 2 without a success report.

Reports contain schema version, operation, outcome, and capability results with
status, request requirement, release requirement, reason, and tracking issue.
When GitHub provides a step-summary file, the same report is appended as an operator
summary. A successful reporting job is never a passing workload check.

## Inventory

| Capability | Status | Mandatory for release | Next implementation |
| --- | --- | --- | --- |
| contract-validation | unsupported | yes | #3: Reference workload and contract execution |
| policy-review | unsupported | yes | #4: Trusted policies; #8: Human approval |
| coverage | unsupported | yes | #5: Coverage enforcement |
| secret-scanning | unsupported | yes | #6: Real security scans |
| dependency-scanning | unsupported | yes | #6: Dependency findings |
| sast-policy | unsupported | yes | #7: CodeQL severity enforcement |
| release-certification | unsupported | yes | #14: Exact-revision certification |
| agent-remediation | unsupported; writes disabled | no | #10/#11: Bounded, authorized remediation |
| dependency-automation | unsupported; updates/merges disabled | no | #12: Governed dependency updates |
| health-monitoring | unsupported; alerts/rollback disabled | no | #17/#18: Monitoring and rollback |
| release-publication | unsupported; publication/deployment disabled | no | #15/#16: Publication and deployment |

The release-required list is a fixed conservative baseline. YAML policies are not
parsed or enforced by this readiness interface; changing a policy cannot enable a
missing capability. Schema validation, profile-aware requirements, approved
exceptions, and actual gate evidence follow in the implementation tickets.

## GitHub workflow behavior

All seven workflows use only `contents: read`, disable checkout credential
persistence, and have bounded job timeouts. No workflow approves or merges PRs,
pushes code, creates fix PRs or incident issues, dispatches remediation, publishes
packages/releases, deploys, or rolls back workloads.

CI validation, Security, Agent Review, and Release Certification report unsupported
capabilities and intentionally fail. A separate CI job runs template tests and
typechecking; its success must not replace workload-required checks in repository
protections. Dependency and Health schedules only report unsupported status; they
do not maintain dependencies or measure health. Remediation has only a manual
reporting entry point; issue-comment and repository-dispatch triggers are removed.

The incomplete CodeQL/build setup is withdrawn until the supported workload and
finding-severity gate exist. This baseline does not perform SAST or secret scanning.

Before adopting the template, configure repository protections to require actual
workload gates and read the reports. This repository does not provision or verify
hosted protections yet (#9); a failing workflow alone does not prevent GitHub merges
unless the repository requires it. Do not resolve intentional failures by bypassing
checks or replacing unsupported results with success messages.

## Verification and enabling future capabilities

Tests invoke the public CLI and exercise commands extracted from the YAML workflow
fixtures, checking permissions, safe steps, exit codes, JSON outcomes, and GitHub
summary output. These local fixtures do not emulate GitHub token restrictions,
branch rules, or hosted events; those require a dedicated integration repository.

Future tickets must implement each gate, demonstrate successful and denied behavior,
and supply revision-bound evidence before restoring privileged jobs. Changing labels,
policy declarations, persona instructions, or capability messages alone is not an
enablement mechanism. Preserve separate read-only validation and authorized write
jobs as capabilities are implemented.
