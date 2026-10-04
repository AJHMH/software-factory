# ADR 002: Verify retained build artifacts without rebuilding

## Context

Downstream consumers need to identify which source and dependency set produced a workload artifact. Rebuilding during consumption could silently produce different bytes and break that association.

## Decision

Factory CI builds the reference workload once, then retains the built module with an SPDX 2.3 SBOM and revision-bound source and validation evidence. The SBOM comes from the committed npm lockfile and names the npm registry, lockfile, package URLs, tarball locations, and integrity digests. A separate read-only consumer downloads the artifact by producer run ID and verifies it against the recorded source commit without rebuilding.

Artifact verification remains distinct from release certification, GitHub Release publication, and deployment.

## Status

Accepted

## Consequences

- Consumers can verify the exact retained bytes and dependency metadata against the source revision.
- Artifacts use GitHub Actions retention and expire after 90 days; consumers must retain copies elsewhere if they need longer availability.
- The initial implementation supports the reference Node 24 workload, npm lockfile version 3, and the public npm registry.
- Successful artifact verification does not imply that every release or deployment policy has passed.
