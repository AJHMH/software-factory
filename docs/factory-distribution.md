# Versioned Factory adoption

Factory distribution API v1 ships `factory-distribution.yaml` with the reusable
`factory-consumer-validation.yml` and `factory-consumer-certification.yml` entry
points. Consumers call these workflows by full commit SHA; they do not copy the
Factory scripts, policy files, or pipeline steps. Factory semantic versions are
metadata in the pinned manifest. A `factory-v1.x.y` tag can name a reviewed
distribution commit, but consumer calls still use its resolved full SHA.

## Compatibility and trust

Version 1 supports contract 1.0, policy pack `baseline-1`, Node 24, and profile
`node-24`. Its `single-module-npm-v1` artifact adapter requires a nested workload
directory with an npm lockfile v3, registry dependencies, `src/index.mjs`, a pinned
TypeScript development dependency, and a build that copies the module to
`dist/index.mjs`. The bundle retains the legacy filename `reference-workload.mjs`;
its source evidence records the actual consumer workload identity. Workspaces,
Next.js output, other runtimes, and unknown major versions are unsupported. They
must not be represented as certified by this adapter.

`AJHMH/developer-agentic-os` is the second integration consumer. Its isolated
`factory-test-workload` tests this supported profile. The Next.js application and
its existing CI, CodeQL, deployment, and repository protection rules remain separate.
The example workload lives in `examples/consumer-workload` here.

The reusable workflow checks out its own repository and commit from GitHub's
`job.workflow_repository` and `job.workflow_sha`, independently of caller inputs.
All policies come from that commit. The consumer's repository Actions variable
`FACTORY_DISTRIBUTION_REVISION` selects the operator-approved full SHA and must
match the executing workflow and committed consumer lock. Candidate contracts
and workflow inputs cannot authorize a new policy revision. The report records
the policy pack digest and separate Factory and consumer revisions.

The Factory repository was reviewed and made public for this integration because
GitHub public repositories cannot call private reusable workflows. See the
[publication review](factory-publication-review.md) and GitHub's
[workflow access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).

## Onboarding

1. Select a reviewed immutable Factory commit. Create `factory.lock.yaml`:

   ```yaml
   schema_version: 1
   factory:
     repository: AJHMH/software-factory
     revision: <full-reviewed-SHA>
     version: 1.0.0
     profile: node-24
     policy_pack: baseline-1
   ```

2. Add a contract at the consumer root, using the supported workload layout and
   bounded install, validate, test, and build commands. Ignore generated `tmp/`,
   workload `dist/`, and workload `node_modules/` output. Commit adoption files
   before checking them: uncommitted drift is rejected.
3. Add `.github/workflows/factory-adoption.yml` with jobs named `validation` and
   `certification`. Both jobs must call their corresponding reusable entry point
   at exactly the lock's full SHA. The validation input `source_revision` is the
   exact consumer commit. Grant only Contents read; certification separately needs
   Actions read and Pull requests read. Do not use `secrets: inherit`.
4. Configure `FACTORY_DISTRIBUTION_REVISION` with the approved SHA. This is an
   operator selection, not a GitHub PR approval or permission to publish a release.
5. Run `distribution --mode inspect` through the pinned public CLI before executing
   the workload. Use `--mode validate` to enforce policy and execute all four gates.

   ```powershell
   node factory/scripts/factory-validation.mjs distribution --mode inspect --trusted-repo factory --trusted-revision <SHA> --factory-repository AJHMH/software-factory --approved-revision <SHA> --consumer-repo consumer
   ```

Validation returns nonzero for failed gates, policy violations, mismatched calls,
unapproved pins, or unsupported combinations. It retains a report separately from
the immutable artifact. Packaging and certification use the same adoption checks
and read the consumer source history without borrowing Factory source commits.

## Certification and governance

Certification is a separate consumer dispatch after a successful adoption **push
to main**. Supply the producer run ID, exact source revision, merged PR number, and
a complete evidence bundle containing actual validation, policy, coverage, security,
SAST, and human review reports. The producer must be the matching successful
`factory-adoption.yml` push; downloads bind the source SHA and producer run ID.

Every non-validation gate report must be produced with the pinned Factory policy
revision. Human review applies to the PR's exact head and source base, uses that
same Factory policy revision, and must still be current in GitHub. Certification
re-verifies the required check identities, independent human review, live repository
protections, defect limits, bundle bytes, SBOM, and dependency sources. It executes
no consumer install, tests, or build. Missing controls produce a failed gate;
an adoption validation pass alone is not certification.

The distributed baseline preserves all existing governance requirements. A consumer
must provision the complete policy-required check contexts and protections before
successful certification. Keep its existing CI and CodeQL requirements, and add
Factory controls only through an explicitly authorized protection change. Do not
rename, drop, or waive required checks to make a demonstration green. The single
test workload does not certify the surrounding application or authorize deployment.

## Controlled upgrade and recovery

Prepare a PR changing the manifest version in the lock and **both** workflow calls
to a new immutable SHA. Inspect the policy diff, runtime/profile compatibility,
mandatory check identities, human-review requirements, coverage thresholds, security
thresholds, and artifact format. Retain prior lock, pin, and evidence. An upgrade
that weakens governance needs separate governance review; routine upgrade adoption
must not silently reduce it.

Until an operator selects the exact reviewed new commit in the Actions variable,
the proposed upgrade fails clearly. After review and selection, matching lock/calls
pass inspection and execute the same enforced gates. If the upgrade fails, revert
the lock and both calls in a reviewed commit and restore the prior approved variable.
Never move an existing version tag, disable gates, rewrite source history, or change
the profile to hide an unsupported workload. Tests cover mismatches, failed gates,
compatible upgrades, and recovery to the original pin.

GitHub workflow identity properties are documented in the
[job context reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#job-context).
They are unavailable on GitHub Enterprise Server; this distribution currently
targets GitHub Cloud and fails rather than falling back to mutable caller metadata.

For distribution 1.0.1 gate production, scoped read setup, exact hosted check names, evidence assembly and certification recovery, see [consumer certification](consumer-certification.md) and [ADR 008](adrs/008-consumer-certification-evidence.md).
