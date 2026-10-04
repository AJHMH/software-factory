# ADR 003: Controlled artifact promotion

## Status

Accepted

## Context

Factory release publication now produces a signed, certified, immutable artifact. A separate operation is needed to exercise deployment controls without rebuilding that artifact or selecting a production cloud provider. The operation must wait for a human environment approval, serialize conflicts, retain the prior stable identity, and record health and migration evidence.

## Decision

Use a protected GitHub `reference` Environment and a provider-neutral filesystem reference adapter. The workflow verifies the published asset attestations and certificate bindings, promotes the exact release assets, runs digest and health checks, retains the successful package as a GitHub Actions artifact, and writes the receipt to the GitHub Deployments API. The API history supplies the previous successful stable identity on subsequent promotions. The policy allows only the `none` migration strategy and grants the job read access to source and workflow artifacts plus deployment-record write access.

This environment is a durable reference package and deployment record, not a running service. Selecting a production runtime or cloud remains a later, separately governed change.

## Consequences

Promotion is reviewable and testable using the GitHub integration without cloud accounts or secrets. The actual package artifact is retained for 90 days; GitHub deployment metadata persists its identity and outcome. A serving environment, runtime health probe, rollback action, and longer-term package storage require a future adapter decision.
