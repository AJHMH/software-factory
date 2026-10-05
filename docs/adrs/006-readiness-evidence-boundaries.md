# ADR 006: Separate demonstration evidence from readiness

Status: accepted

## Context

Implemented gates and green fixture scenarios do not establish a successful
hosted release, runtime recovery or compliance. Ticket #20 needs a reproducible
demonstration through Factory Validation without creating external mutations.

## Decision

Expose `readiness --mode inspect|demonstrate` at the public CLI. Execute a fixed
list of existing public-interface suites from the trusted checkout, strip operator
credentials and retain only bounded summaries and output digests. Identify this
evidence as controlled tests and explicitly report skipped integrations. Historical
GitHub evidence remains in a dated, revision-bound report linked to operator docs.

Keep readiness incomplete until reviewed live evidence closes the documented
gaps. Demonstration success authorizes no merge, publication or deployment. No
arbitrary command/provider or candidate-selected scenario is supported.

## Consequences

Operators can reproduce local behavior without confusing mock GitHub responses
with live controls. The report must be updated as live evidence changes. Local
digests are identifiers rather than attestations. Reference package recovery
does not prove recovery of a running service, and retention tests cannot establish
compliance in another storage system.
