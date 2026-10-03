# Software Factory Template

A reusable Software Factory blueprint for governed validation, release, and operations.
This repository is currently a safe scaffold, not an operational delivery platform.

## Current capability status

Workload validation, policy review, coverage enforcement, security gates, and release
certification are **unsupported**. Required workflow gates deliberately fail until
their implementations and evidence checks exist. Dependency merging, agent writes,
release publication, deployment, health alerts, and rollback are disabled.

See [the capability inventory and operator guide](docs/capabilities.md) for the
meaning of each status, workflow behavior, and implementation tickets.
Policies and agent personas describe target behavior; they do not enable automation
or establish compliance. Passing template tests is not evidence of a clean workload.

Code-quality and security review currently use GitHub's security policy, Dependabot
alerts, code scanning alerts, and secret scanning alerts. CodeRabbit is not required.
See [security review sources and availability](docs/security.md) and the
[security policy](.github/SECURITY.md). Disabled or missing scans cannot pass a gate.

## Run the safety interface locally

Install Node.js 24 or later. The capability interface needs no npm dependencies:

```sh
node scripts/factory-validation.mjs inventory
node scripts/factory-validation.mjs capability agent-remediation
node scripts/factory-validation.mjs capability contract-validation --required
node scripts/factory-validation.mjs certify
```

The first two commands report unsupported capabilities and exit 0. Required gates
and certification exit 1. Invalid commands exit 2. All valid commands emit JSON.

## Verify the template

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

These commands verify the public safety interface and workflow fixtures. They do
not execute the illustrative workload commands in the factory contract; a runnable
reference workload follows in [issue #3](https://github.com/aaron-howard/software-factory/issues/3).
