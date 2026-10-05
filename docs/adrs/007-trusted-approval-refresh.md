# ADR 007: Refresh existing approval jobs from trusted base code

Status: accepted

## Context

A new review-triggered check can pass while an earlier required check remains
failed. The trusted target workflow does not receive review events. Automatic
refresh must not execute candidate code with mutation credentials or grant approval.

## Decision

Use a read-only review observer and a default-branch `workflow_run` worker. Resolve
the request against live GitHub metadata and explicit trusted-policy human callers.
Pin write-job code to the exact current base. Bind original runs with immutable
PR/head/base run titles, since hosted run associations can be empty. Rerun only
the existing allowlisted approval jobs with Actions write; retain their original
validator, event identity and token permissions. Do not publish replacement checks.

Revalidate identity, reviews and permission before mutations. Serialize per PR,
preflight both jobs, report partial requests, bound waits/inventories and suppress
replayed events only when evaluation clearly followed the event. Timestamp ties
must not preserve a potentially stale approval.

## Consequences

Human review remains necessary, including bootstrap. Candidate observer data is
not approval authority. API/scheduler failure and unsupported forks fail closed.
Old unbound/expired runs require operator recovery. Hosted event delivery must be
verified after adoption; fixture tests cannot establish it.
