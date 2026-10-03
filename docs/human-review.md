# Human approval enforcement

Ticket #8 adds a public approval gate. `human-review` evaluates normalized JSON;
`collect-reviews` reads live GitHub PR metadata, the complete submitted review
history, and each reviewer's current repository permission. Neither operation
approves a PR or grants a policy exception.

```sh
node scripts/factory-validation.mjs collect-reviews \
  --repository AJHMH/software-factory --pull-request 26 \
  --base-revision <full-base-SHA> --trusted-revision <full-policy-SHA> \
  --coverage-evidence github --output tmp/human-review-evidence.json
```

Set `FACTORY_GITHUB_TOKEN` through the runner's environment. Required permissions
are contents, pull requests, actions, and implicit metadata read. Do not put a
token into an evidence file. Local evaluation accepts `--evidence <file>` and
`--coverage-evidence <file>` instead of fetching GitHub. Local JSON proves
consistency; the collector establishes its GitHub source. Release authentication,
retention, and certification remain ticket #14 work.

## Authoritative rules

The caller pins the base and trusted policy commits. The gate reads
`policies/human-review.yaml` from that trusted commit, never from candidate policy.
It compares committed base/head trees, counts added plus deleted lines, and exposes
both old and new names for moves. Binary changes exceed the line threshold because
their line count cannot be established. The base must be an ancestor of the head;
update a stale branch before retrying.

The existing policy requires one approval by default and two for critical changes:
mandatory path matches, more than 500 changed lines, database schema changes, or
decreased line/branch coverage. Glob `**/` includes zero directories, so workflows
directly beneath `.github/workflows` are covered. Database detection covers SQL,
schema.sql/schema.prisma, migration directories, database/db, Prisma, and Drizzle.
Add application-specific schema locations to mandatory paths. Factory policy,
evaluator, schema, profile, workflow, and exception files are always sensitive.

Coverage comparisons use the existing coverage evaluator, which checks source
digests, completeness, and the exact head/base/contract. Changes outside the
committed workload cannot decrease its measured coverage and report not applicable.
Changed workloads require valid coverage evidence. Human approval does not waive
the separate Quality coverage gate, even when humans approve a decrease.

## Approval identity and freshness

Count distinct reviewers with a submitted APPROVED review for exactly the current
head. Require GitHub User identity and current write/maintain/admin permission.
Exclude bots, registered `agent_accounts`, the PR author, and owners of proposed
exceptions. Latest approval/changes-requested/dismissal controls each reviewer;
comments preserve the prior decision. Dismissed or old-head approvals do not count.
Outstanding changes requested by eligible reviewers block the gate.

Agents must use separate identities and must be registered when operating through
User accounts. GitHub cannot determine whether a person or automation controlled a
shared User token; shared reviewer credentials cannot establish human independence.
This factory's workflows have no approval/merge/write permissions. Exception
scope, expiry, and independent trusted ledger checks remain mandatory separately.

## Hosted checks and remaining integration

Factory Human Review runs on PR updates and submitted/edited/dismissed reviews.
It reads the exact PR head, cancels superseded runs for the same PR, and rechecks
live head/base before producing a result. Factory Coverage retains one JSON
artifact for seven days, including when its measured thresholds fail. The review
collector selects the exact-head PR coverage run, reads only evidence.json from
a bounded archive, and validates its content; it never executes an artifact.
Evidence is limited to hashes, counts, paths, reviewer identities, and review IDs.
Review bodies and credentials are excluded.

Configure `Enforce Factory human approval` as a required GitHub Actions check and
retain native stale-review dismissal and review-thread resolution. Ticket #9 must
complete protection drift, fork verification, trusted evaluator/workflow bootstrap,
and the merge-time authorization boundary. This workflow currently runs the
candidate evaluator under read-only permissions; loading policy from base does
not prevent a malicious PR from editing its own evaluator/workflow. Do not claim
that boundary is solved until #9 lands. Native independent review requirements
provide an additional hosted protection during this increment.

The repository currently has only the PR author's account as collaborator. Add two
independent human collaborators with write access before landing this sensitive
implementation. Tests with synthetic review identities exercise decisions, but do
not establish that real people approved the implementation.

API contracts: [reviews](https://docs.github.com/en/rest/pulls/reviews),
[reviewer permissions](https://docs.github.com/en/rest/collaborators), and
[review events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
