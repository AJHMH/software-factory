# Factory operator guide

The Factory is a governed delivery product. `aaron-howard` owns policy, readiness decisions and the sole required human PR review. The `ajhmh-software-factory` App creates proposals. Workload owners maintain contracts, dependencies and health targets. The host operator owns private credentials, trusted checkouts, durable state, cleanup and recovery.

## Onboard and upgrade

1. Adopt the supported version, policy pack, exact Factory SHA and independent approved revision using [distribution](factory-distribution.md).
2. Select a supported [execution profile](contract-execution.md) and commit the workload contract. The second consumer's isolated Node 24 workload is supported; its Next.js application is outside this adapter's scope.
3. Configure the [App](factory-github-app.md), [repository protection](repository-governance.md) and [human review](human-review.md). Keep the PEM outside Git and GitHub. Verify live rulesets, including bypass actors, with scoped read credentials.
4. Run validation, security, coverage and SAST gates; inspect immutable artifact evidence and denial paths.
5. Run the [readiness demonstration](governed-automation-readiness.md) and record exact commits, conclusions, skipped checks and outstanding gaps.

Policies and profiles are reviewed versioned inputs. Track work with the five [triage labels](agents/triage-labels.md). Keep architectural decisions in [ADRs](adrs/) and domain vocabulary in [CONTEXT](../CONTEXT.md). Follow distribution's compatible upgrade/recovery procedure and [ADR 005](adrs/005-versioned-factory-distribution.md). Review both lock and independently approved revision, validate before merge, and recover by reselecting a known-good compatible pin through the same human process.

Exceptions require an owner, independent authorized approver, reason, scope, exact revision/digest and expiry. Follow [policy evaluation](policy-evaluation.md) and [security enforcement](security-enforcement.md). Candidate edits and expired exceptions cannot authorize themselves. Escalate unsupported profiles, major dependency changes or unavailable gates.

## Deliver and respond

Follow [artifacts](traceable-build-artifacts.md), [certification](release-certification.md) and [signed releases](versioned-releases.md) in order. Preserve exact-source producer/certificate run IDs and verified asset attestations. Publication requires authorized dispatch. [Promotion](artifact-promotion.md) also requires the protected GitHub Environment and consumes the same bundle without rebuilding.

Configure the HTTPS endpoint and workload ID using [operations](operations.md). GitHub Issues carry incidents; scheduling is best effort. Investigate probes, retain deployment/health receipts and follow the [rollback runbook](runbooks/deployment-rollback.md). Migration requirements, unsafe state or failed verification escalate to a human. Reference package restoration does not establish running-service recovery.

Use [bounded agents](bounded-agent-proposals.md) and [authorized remediation](authorized-remediation.md). Actual local publication requires preparation, inspection and the exact human-authorized digest through [local remediation](local-remediation.md). Preserve budgets/replay reservations. That gate cannot provide the required GitHub review.

## Audit and retention

Retain revision-bound reports, current reviews, check conclusions, artifact/SBOM digests, verified attestations and deployment/incident receipts. Revalidate authorization before mutations. [Approval refresh](approval-refresh.md) requests reevaluation of existing jobs after current reviews. Bootstrap, stale/unbound runs or unavailable APIs can require an operator rerun after inspecting actual GitHub review evidence.

Schedule `prune-agent-evidence` at least daily. Detailed private evidence expires under trusted policy; minimal cost/identity/replay reservations remain durable. [Bounded agents](bounded-agent-proposals.md) explains redaction and host ACLs. Delivery/health retention is configured in workflows (health: 90 days); verify actual hosted expiry and storage access before claiming it works. Keep raw diagnostics private. Fixture cleanup does not prove remote retention or compliance.

The [readiness report](governed-automation-readiness.md) distinguishes observed behavior, configuration, synthetic API evidence and unsupported capabilities. Compliance certification, unrestricted autonomy and production-provider selection are outside scope.
