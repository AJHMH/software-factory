# Human approval enforcement

Ticket #8 adds a public approval gate. `human-review` evaluates normalized JSON;
`collect-reviews` reads live GitHub PR metadata, the complete submitted review
history, and each reviewer's current repository permission. Neither operation
approves a PR or grants a policy exception.

```sh
node scripts/factory-validation.mjs collect-reviews \
  --repository AJHMH/software-factory --pull-request <number> \
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

The owner selected a solo-developer policy: one approval from `aaron-howard` for
both ordinary and critical changes. Critical changes are still identified:
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
head. Require GitHub User identity, membership in the trusted `human_approvers`
list when configured, and current write/maintain/admin permission.
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

Main requires `Enforce Factory human approval` from GitHub Actions (app 15368),
alongside Factory SAST, with strict up-to-date checks. The native ruleset requires
one independent approval and retains stale-review dismissal, review-thread
resolution, and its existing CodeQL/security/quality rules without bypass actors.
The proposed solo-developer policy keeps the evaluated count at one for sensitive
changes. Until that policy is governed and adopted on main, its previous two-review
count remains authoritative for this bootstrap PR. Ticket #9 must
complete protection drift, fork verification, trusted evaluator/workflow bootstrap,
and the merge-time authorization boundary. This workflow currently runs the
candidate evaluator under read-only permissions; loading policy from base does
not prevent a malicious PR from editing its own evaluator/workflow. Do not claim
that boundary is solved until #9 lands. Native independent review requirements
provide an additional hosted protection during this increment.

The repository has one human owner. Use the dedicated Factory GitHub App to author
proposals and the owner account to approve them; GitHub does not allow authors to
approve their own PRs. See [Factory App setup](factory-github-app.md). Existing
owner-authored PR #26 needs replacement under the App identity. Tests with synthetic
review identities exercise decisions but do not establish actual human approval.

API contracts: [reviews](https://docs.github.com/en/rest/pulls/reviews),
[reviewer permissions](https://docs.github.com/en/rest/collaborators), and
[review events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
