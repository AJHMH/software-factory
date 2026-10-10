# ADR 009: Independent TypeScript CLI consumer

Status: Proposed

## Context

The owner wants both feature delivery and CI certification for
`AJHMH/developer-os`, alongside the existing `AJHMH/profile-page` consumer. The
current single-module adapter supports only an isolated module and cannot
represent the real TypeScript CLI build. The Developer OS delivery controller
already accepts repository identities but production execution remains gated by
its own qualification work.

## Decision

Add a separate opt-in `node-24-typescript-cli` profile in distribution 1.1.0.
Keep the original profile and consumer pin unchanged. Bind the full compiled CLI
tree, committed compiler configuration and source inventory to exact-source
validation and the npm SPDX SBOM. Retain a bounded canonical data bundle; verify
it without rebuilding or extracting executable files. Reuse every baseline
policy, protection, review and certification requirement with a source-mapped
TypeScript coverage adapter. Unsupported layouts fail closed.

Onboard each repository with separate independently selected Factory authority,
App access, signed proposals, owner review, check identities, read credentials
and certificates. Candidate onboarding files are never themselves delivery
authority. Production controller qualification remains independent of CI.

## Consequences

This extends ADR 005's supported-profile set explicitly; it does not broaden the
original single-module adapter's guarantee or certify profile-page's surrounding
application. CLI runtime dependencies, alternate compiler layouts, release
publication, promotion and rollback remain unsupported. No certificate or
autonomous delivery readiness is claimed before live gates succeed.
