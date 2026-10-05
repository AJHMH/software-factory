# Software Factory context

This repository is a governed software-factory template. Projects expose a workload through `factory-contract.yaml`; trusted Factory policy and GitHub workflows validate that workload before downstream consumers use its outputs.

## Traceable workload artifacts

The Factory CI workflow validates, tests, and builds the reference workload once at a commit. The same run records source and validation evidence, creates an SPDX 2.3 SBOM from the committed npm lockfile, and retains the built module and evidence in an immutable GitHub Actions artifact. The artifact name binds the source commit to its producer run.

The release workflow consumes a successful `main` CI run's artifact and verifies its bytes, SBOM, dependency sources, validation report, and source revision without rebuilding. Operators can also dispatch that consumer with a producer run ID and source commit. Artifact verification does not publish a release or authorize deployment; release certification and publication remain separate capabilities.

See [traceable build artifacts](docs/traceable-build-artifacts.md) and [ADR 002](docs/adrs/002-traceable-build-artifacts.md).

## Controlled reference promotion

The signed, certified release can be promoted without rebuilding through the GitHub `reference` Environment. The protected job verifies release attestations, copies the exact bundle through the filesystem reference adapter, records health and migration metadata, retains the package as a workflow artifact, and writes a GitHub Deployment record. See [artifact promotion](docs/artifact-promotion.md) and [ADR 003](docs/adrs/003-controlled-artifact-promotion.md).

The local `rollback` operation correlates health failures with retained deployment
evidence, restores a compatible previous reference package without rebuilding, and
verifies its bytes. It records one attempt per deployment and escalates unsafe or
unsupported recovery. Reference package restoration does not establish running
service recovery. See the [rollback runbook](docs/runbooks/deployment-rollback.md)
and [ADR 004](docs/adrs/004-reference-package-rollback.md).

## Versioned Factory consumers

Required approval jobs can be refreshed after review events through a read-only
observer and a trusted-base worker. The worker reruns existing validators without
granting approval or bypassing protections. See
[approval refresh](docs/approval-refresh.md) and
[ADR 007](docs/adrs/007-trusted-approval-refresh.md).

The public `readiness --mode inspect|demonstrate` operation runs controlled CLI
scenarios separately from live GitHub readiness evidence. A passing demonstration
does not certify publication, hosted promotion, runtime recovery or compliance.
See [readiness](docs/governed-automation-readiness.md), the
[operator guide](docs/OPERATING_MODEL.md) and
[ADR 006](docs/adrs/006-readiness-evidence-boundaries.md).

Factory distribution v1 exposes SHA-pinned reusable validation/certification
workflows and a baseline policy pack. A consumer lock and independently selected
repository variable must match the executing Factory revision. Consumer source
history stays separate from Factory policy history. The second integration consumer
uses an isolated Node 24 test workload in `AJHMH/developer-agentic-os`; its Next.js
application is outside the single-module adapter's certification scope. See
[distribution](docs/factory-distribution.md) and
[ADR 005](docs/adrs/005-versioned-factory-distribution.md).
