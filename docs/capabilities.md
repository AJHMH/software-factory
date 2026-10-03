# Factory capability inventory and operator guide

## Status and guarantees

The Factory provides truthful readiness reporting and executable contract validation
for a Node 24 reference workload, plus scoped trusted execution-policy evaluation.
Other required gates remain unsupported and
optional mutation paths are disabled. This extends issue #2's safe baseline;
it is not a Governed Automation readiness claim.

The public interface is `node scripts/factory-validation.mjs`:

- `inventory` reports all capabilities and exits 0; it does not approve delivery.
- `capability <name>` reports metadata and exits 0. Available execution reports
  not-run; unsupported capabilities report unsupported. No gate has passed.
- `capability <name> --required` exits 1 without executed evidence.
- `profile` validates a contract and returns its selected runtime without execution.
- `validate` executes the supported contract and exits 0 only if all commands pass.
- `policy --trusted-revision <SHA>` evaluates contract execution limits against
  committed trusted policy and approved exceptions; it does not execute commands.
- `measure-coverage --base-revision <SHA> --trusted-revision <SHA>` runs the Node
  coverage adapter and enforces trusted Quality policy on committed source snapshots.
- `coverage --evidence <file> --base-revision <SHA> --trusted-revision <SHA>` evaluates
  revision-bound coverage evidence without executing tests.
- `scan-security --trusted-revision <SHA>` scans committed source with pinned scanners.
- `security --trusted-revision <SHA> --evidence <file>` evaluates redacted security evidence.
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
| contract-validation | available; evidence requires execution | yes | #3 implemented; release evidence integration follows |
| policy-review | available for execution limits; hosted human review unavailable | yes | #4 implemented locally; #8: Human approval |
| coverage | available; actual measurement/evaluation required | yes | #5 implemented; #9/#14: hosted protections and certification |
| secret-scanning | available; executed evidence required | yes | #6 implemented; #9/#14: protection and certification |
| dependency-scanning | available; executed evidence required | yes | #6 implemented; #9/#14: protection and certification |
| sast-policy | unsupported | yes | #7: CodeQL severity enforcement |
| release-certification | unsupported | yes | #14: Exact-revision certification |
| agent-remediation | unsupported; writes disabled | no | #10/#11: Bounded, authorized remediation |
| dependency-automation | unsupported; updates/merges disabled | no | #12: Governed dependency updates |
| health-monitoring | unsupported; alerts/rollback disabled | no | #17/#18: Monitoring and rollback |
| release-publication | unsupported; publication/deployment disabled | no | #15/#16: Publication and deployment |

See [contract execution](contract-execution.md) for schema, runtime, shell,
timeouts, revision metadata, and example workload.
The release-required list is a fixed conservative baseline. See
[trusted policy evaluation](policy-evaluation.md) for the versioned execution pack,
profile precedence, and approved exceptions. Other YAML policy declarations are
not enforced by this interface; changing a policy cannot enable a missing capability.

## GitHub workflow behavior

All Factory workflows use only `contents: read`, disable checkout credential
persistence, and have bounded job timeouts. No workflow approves or merges PRs,
pushes code, creates fix PRs or incident issues, dispatches remediation, publishes
packages/releases, deploys, or rolls back workloads.

CI installs Factory tools, selects the supported runtime from the validated
contract, and executes the reference workload. Security runs pinned scanners;
Agent Review reports unavailable integration status. Release
Certification remains blocked and intentionally fails. A separate CI job runs template tests and
typechecking; its success must not replace workload-required checks in repository
protections. Dependency and Health schedules only report unsupported status; they
do not maintain dependencies or measure health. Remediation has only a manual
reporting entry point; issue-comment and repository-dispatch triggers are removed.

The new Trusted Policy workflow reads evaluator and policy from the base revision,
with candidate files used as data only. It requires governance-approved bootstrap
before it can operate in GitHub; its green result is execution-policy evidence only.

GitHub-native CodeQL and code quality checks are enabled. Factory secret/dependency
scans supplement GitHub signals with explicit tool-version and revision evidence.
GitHub's security policy, Dependabot alerts, code scanning alerts, and secret
scanning alerts are the selected review sources; CodeRabbit is not required.
See [security review sources and hosted status](security.md). Selecting GitHub
does not make disabled or unimplemented scanning gates pass.

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

## Interim PR integration reporting

Factory security jobs run evaluated gates. Incomplete review jobs report unavailable
status without failing PRs. GitHub-native protections remain active; release certification remains
blocked. See [the restoration plan](governance-follow-ups.md) for tracked follow-up tickets.
