# Software Factory Template

A reusable Software Factory blueprint for governed validation, release, and operations.
This repository is currently a safe scaffold, not an operational delivery platform.

## Current capability status

Contract validation and the Node 24 reference workload execute locally and in CI.
Scoped execution-policy evaluation is available through the public CLI, with
trusted policy revisions and approved exceptions. The Node 24 profile now enforces
revision-bound global and changed-code coverage through the CLI and CI.
Pinned secret/dependency scans enforce revision-bound findings against trusted policy.
Native CodeQL findings are evaluated against trusted severity policy.
Human approval evaluation checks current independent reviews against trusted policy.
Release certification remains **unsupported** and deliberately fails until
its implementation and evidence checks exist. Dependency merging, agent writes,
release publication, deployment, health alerts, and rollback are disabled.

See [the capability inventory and operator guide](docs/capabilities.md) for the
meaning of each status, workflow behavior, and implementation tickets.
See [trusted policy evaluation](docs/policy-evaluation.md) for precedence,
exception approvals, and the trusted GitHub workflow bootstrap.
See [coverage enforcement](docs/coverage-enforcement.md) for measurement, baselines,
thresholds, and approved exceptions.
See [security enforcement](docs/security-enforcement.md) for pinned scanners,
redacted evidence, severity thresholds, and scoped dummy approvals.
See [CodeQL enforcement](docs/sast-enforcement.md) for native analysis identity,
severity rules, error handling, and required checks.
See [human approval enforcement](docs/human-review.md) for review counts, identity,
freshness, exception ownership, and the remaining hosted trust boundary.
Policies and agent personas describe target behavior; they do not enable automation
or establish compliance. Passing template tests is not evidence of a clean workload.

Code-quality and security review currently use GitHub's security policy, Dependabot
alerts, code scanning alerts, and secret scanning alerts. CodeRabbit is not required.
See [security review sources and availability](docs/security.md) and the
[security policy](.github/SECURITY.md). Disabled or missing scans cannot pass a gate.

## Run the safety interface locally

Install Node.js 24. Capability reporting needs no npm dependencies:

```sh
node scripts/factory-validation.mjs inventory
node scripts/factory-validation.mjs capability agent-remediation
node scripts/factory-validation.mjs capability contract-validation --required
node scripts/factory-validation.mjs certify
```

The first two commands report capability status and exit 0. Required capability
metadata requests without executed evidence, and certification, exit 1.
Invalid commands exit 2. All valid commands emit JSON.

To execute the reference workload, install the pinned Factory dependencies first:

```sh
npm ci --ignore-scripts
node scripts/factory-validation.mjs profile
node scripts/factory-validation.mjs validate
```

The versioned contract selects Node 24 and executes install, syntax/type validation,
tests, and build from `examples/reference-workload`. The example's lint command is
a syntax check, not full style-policy enforcement. See [contract execution](docs/contract-execution.md)
for schema, timeout, shell, runtime, and evidence semantics.

## Verify the template

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

These commands verify the public safety interface, contract failure/timeout fixtures,
and workflow fixtures. The CI workflow fixture also executes the reference workload.
Passing these checks does not authorize release; policy/security integration and
revision-bound certification remain separate implementation tickets.

## Interim PR integration reporting

Factory security jobs run evaluated gates. Incomplete review jobs report unavailable
status without failing PRs. GitHub-native protections remain active; release certification remains
blocked. See [the restoration plan](docs/governance-follow-ups.md) for tracked follow-up tickets.
