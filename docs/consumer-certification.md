# Consumer certification runbook

This procedure certifies only `developer-agentic-os/factory-test-workload` under
Node 24 and the single-module adapter. It does not certify the Next.js application,
publish a release, or authorize deployment. Factory distribution 1.0.1 supplies
all baseline gate producers. Adoption validation alone is insufficient.

## Prepare and review

Use a clean consumer checkout. Update `factory.lock.yaml` to version 1.0.1 and the
reviewed Factory commit, and pin both adoption calls to that full SHA. The operator
must select the same `FACTORY_DISTRIBUTION_REVISION` Actions variable before running
that revision. Keep the previous lock and pin for reviewed recovery.

The validation caller grants Contents, Pull requests and Security events read.
The certification caller explicitly forwards `FACTORY_CERTIFICATION_READ_TOKEN` as
`FACTORY_GITHUB_TOKEN`; never inherit all secrets. The token selects only this
consumer with Administration, Checks, Issues and Pull requests read (Metadata read
is implicit). No write or organization scope is needed. Create/enter it directly
in GitHub, set an expiry, and rotate before expiry. Never put it in source, reports,
logs, workflow inputs or chat. No executable workload step receives this token.

Preserve existing application CI and CodeQL checks. The separate Factory CodeQL
workflow analyzes the entire isolated workload at the exact consumer head and
uploads its paired SHA/ref. Its trusted analysis identity is
`.github/workflows/factory-codeql.yml:analyze`; the collector rejects caller-selected
identities outside the pinned Factory profile. Existing application findings are
not dismissed, waived or reclassified by the workload certificate.

## Provision protections

First land the gate producers through an App-authored PR and current owner review.
Only after the eight gates are available on main, use the explicitly authorized
`bootstrap-governance` with separate local administration authority. Include the
same distribution arguments as inspection. It manages a separate no-bypass
`Factory governed default branch` ruleset, preserving unrelated CI/CodeQL rules.
The consumer check names are `validation / ` followed by each baseline name:

- Execute Factory Contract Validation
- Verify Factory safety controls
- Evaluate trusted execution policy
- Enforce Factory coverage
- Enforce Factory secret and dependency policy
- Enforce Factory SAST policy
- Enforce Factory human approval
- Enforce Factory trusted human approval

The prefix is derived from the enforced immutable adoption job `validation`, not
an arbitrary caller rename. Every baseline check and its Actions integration
identity remains required. Reviews, stale dismissal, resolved threads, signatures,
linear history, deletion prevention and force-push prevention must all pass live
inspection. Do not give bootstrap authority to any hosted workflow.

## Produce and collect evidence

Obtain a current owner GitHub approval for the exact proposal head. Refresh its
read-only review jobs after approval if needed. Every required check must pass
before a conditional merge. A passing main adoption push must produce the package;
feature runs, dispatches, failed runs and earlier commits cannot replace it.

The producer resolves exactly one merged PR whose merge commit is its source
revision. Coverage uses the source merge's first parent. Human review is collected
at the original reviewed head, explicitly bound by `--merged-revision` to that
merged source and original base; live review changes still invalidate it. No
approval is manufactured for the squash commit.

Download artifacts from that one producer run. Keep their manifest/run IDs. Copy
`validation-evidence.json` from the package into a private reports directory as
`validation.json`; download `policy.json`, `coverage.json`, `security.json`,
`sast.json`, and `human_review.json` from the corresponding gate artifacts.
Do not edit outcomes, revisions, digests or review identities.

```powershell
node factory/scripts/factory-validation.mjs consumer-evidence --reports-directory <reports-dir> --source-revision <merge-SHA> --trusted-revision <Factory-SHA> --base-revision <merge-first-parent> --review-head <approved-PR-head> --output <new-bundle.json>
```

Assembly validates six passing reports, digests and independent identities. It
reports `certification: not-run`; supplied files never establish hosted approval.
Dispatch consumer `factory-adoption.yml` on main with `source_revision`,
`producer_run_id`, `pull_request_number`, and the assembled JSON `evidence_bundle`.
The pinned certification entry point retrieves the original immutable package and
verifies bytes, SBOM, dependency sources, exact reports, current GitHub approval,
required checks, protections and defect limits without rebuilding or executing
consumer code.

Download and retain `factory-consumer-certificate-<source>-<certification-run>`.
Record the source and Factory revisions, producer/certification URLs, merged PR,
certificate digest, artifact/SBOM digests, check IDs, independent approval and
protection evidence in ticket #49. Do not report success before the hosted
certificate exists.

## Failures and recovery

Missing, malformed, failed, stale or mismatched evidence blocks assembly or
certification. A revoked/self/agent approval, wrong producer, missing protection,
unsupported workload or unsuccessful required check blocks delivery. Repeat the
actual gate at the same revision where possible; otherwise prepare a new reviewed
source revision and main producer. Do not relabel an old artifact as certified.

If an adoption upgrade fails, restore the prior lock/calls in a reviewed PR and
restore its independently approved pin. Preserve failed evidence for diagnosis.
A previous validation-only revision remains uncertified until complete matching
live evidence exists. GitHub configuration compliance is not runtime authorization.
