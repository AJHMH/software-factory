# Software Factory context

This repository is a governed software-factory template. Projects expose a workload through `factory-contract.yaml`; trusted Factory policy and GitHub workflows validate that workload before downstream consumers use its outputs.

## Traceable workload artifacts

The Factory CI workflow validates, tests, and builds the reference workload once at a commit. The same run records source and validation evidence, creates an SPDX 2.3 SBOM from the committed npm lockfile, and retains the built module and evidence in an immutable GitHub Actions artifact. The artifact name binds the source commit to its producer run.

The release workflow consumes a successful `main` CI run's artifact and verifies its bytes, SBOM, dependency sources, validation report, and source revision without rebuilding. Operators can also dispatch that consumer with a producer run ID and source commit. Artifact verification does not publish a release or authorize deployment; release certification and publication remain separate capabilities.

See [traceable build artifacts](docs/traceable-build-artifacts.md) and [ADR 002](docs/adrs/002-traceable-build-artifacts.md).
