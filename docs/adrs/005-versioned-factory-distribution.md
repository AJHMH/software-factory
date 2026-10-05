# ADR 005: Versioned Factory distribution

## Status

Accepted

## Context

Issue #19 requires a second consumer to adopt the Factory through pinned reusable
workflows and policy packs. Existing artifact/certification paths assumed shared
source and policy history. The selected consumer is a public Next.js repository,
while the implemented build adapter supports a single Node module.

## Decision

Distribute versioned validation and certification entry points, a compatibility
manifest, and the baseline policy pack as one immutable Factory revision. Use
GitHub's executing-job workflow identity to check out the Factory code/policy.
The consumer commits a lock and two SHA-pinned calls; an independently configured
repository variable selects the authorized pin. Validate compatibility and drift
before executing commands, packaging, or certification. Keep consumer source
history and Factory policy history separate throughout evidence verification.

Exercise the supported Node 24 profile through an isolated second test workload
in `developer-agentic-os`. Do not extend the single-module adapter's guarantees
to its surrounding Next.js app. Keep existing application checks and every
Factory certification requirement. The owner authorized making Factory public
after a publication review, enabling the public consumer to call its workflows.

## Consequences

Consumers update calls and lock together through reviewed upgrades, and recover
by returning to the previous approved pin. Certification still requires genuine
human approval and live repository protections. Private/public access boundaries,
unsupported adapters, and missing governance evidence remain explicit failures;
validation success never substitutes for certification or deployment authorization.
