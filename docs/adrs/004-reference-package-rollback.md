# ADR 004: Reference package rollback

## Status

Accepted

## Context

Issue #18 requires safe artifact restoration after correlated deployment failures.
ADR 003 defines a reference package and deployment record rather than a running
service. Monitoring can observe an independently configured workload endpoint, but
cannot establish that changing a reference package recovers that endpoint.

## Decision

Extend the filesystem reference adapter with a public Factory Validation `rollback`
operation. An authorized local operator supplies retained deployment state and a
fresh health report bound to the exact deployment. Pinned committed policy defines
failure thresholds, supported environment/adapter, evidence age, deadline, and a
single attempted restoration per deployment. Restore the previous certified package
by atomically switching the current package identity, verifying bytes before and
afterward, and retaining an attempt record before mutation. Serialize with promotion
using the existing lock. Permit only explicitly compatible `none` migrations.

Unsupported adapters, uncorrelated evidence, unknown migrations, unavailable assets,
verification failures, and deadlines escalate with a redacted report and runbook.
Do not infer endpoint recovery or manipulate source history. Keep automatic health
rollback disabled; hosted artifact retrieval, protected runtime rollback execution,
and GitHub deployment-status updates require a later runtime adapter decision.

## Consequences

Controlled CLI tests exercise real package restoration and denial behavior. Operators
must retain the packages and evidence and handle escalation through the active
incident. The restoration report explicitly distinguishes reference integrity
recovery from unsupported runtime health recovery. Local operator-supplied receipts
are evidence within the retained state trust boundary, not live GitHub authorization.
