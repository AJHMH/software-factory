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
consistency; the collector establishes its GitHub source. Release certification and evidence composition are separate; see
[release certification](release-certification.md).

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
Approval evaluation jobs have no approval or merge permissions. The refresh
worker has Actions write only for bounded existing-job reruns. Exception scope,
expiry, and independent trusted ledger checks remain mandatory separately.

## Hosted approval checks

Both original approval workflows bind the PR number, exact head and base in
their run titles. Evaluator/dependency/policy code is loaded from the base;
candidate source and contract are read as data. The required
`pull_request_target` workflow remains defined by trusted base code. The ordinary
PR workflow has read-only permissions and cannot confer authority on the
privileged refresh worker.

Reviews are observed by a separate read-only workflow. The default-branch worker
validates live identities and explicit human callers, pins its mutation code to
the exact base, and requests reruns of the existing approval jobs. It publishes
no replacement required check and never supplies an approval verdict.
See [approval refresh](approval-refresh.md) for authorization, stale/revoked
approval behavior, bounded replay handling and bootstrap/recovery procedures.

Factory Coverage retains exact-head evidence for seven days, including failed
threshold results. The collector extracts only bounded evidence.json and executes
no artifact. Review bodies and credentials are excluded from evidence.

Main requires both Factory approval contexts from GitHub Actions (app 15368),
strict up-to-date checks, one current independent human review, stale-review
dismissal and review-thread resolution. These protections have no bypass actors.
Live scoped collection remains necessary to verify ruleset visibility; see
[governance integration evidence](governance-integration-evidence.md).

The owner account reviews proposals authored by the dedicated Factory App.
GitHub does not allow authors to approve their own PRs. See [App setup](factory-github-app.md).
Synthetic review identities exercise decisions but cannot establish actual human
approval. Hosted refresh must be demonstrated after its reviewed adoption on main.

API contracts: [reviews](https://docs.github.com/en/rest/pulls/reviews),
[reviewer permissions](https://docs.github.com/en/rest/collaborators), and
[review events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
