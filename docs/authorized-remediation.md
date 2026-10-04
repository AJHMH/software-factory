# Authorized remediation

Ticket #11 supplies a narrow `format-json` adapter. It changes whitespace around
existing JSON tokens in one committed regular JSON file under `src/`, `tests/`, or
`docs/`. It preserves numeric spelling, duplicate keys, ordering, and string escapes.
Invalid JSON, no-op requests, oversized proposals, executable files, and restricted
paths fail closed. General AI repair and vendor execution remain unsupported.

## Public interface and authorization

```text
node scripts/factory-validation.mjs remediate --mode authorize|prepare|publish
  --repository AJHMH/software-factory --trusted-repo <trusted checkout>
  --trusted-revision <current main SHA> --repository-path <source checkout>
  --state-dir <private directory outside source>
```

`authorize` verifies origin, inputs, live collaborator permissions, trusted caller
policy, current main authority, and explicit source branch/SHA without running an
adapter. `prepare` makes a bounded private proposal. `publish` additionally commits
the real fix and opens an App-authored PR. No mode approves or merges.

Trusted code/dependencies/policy come from the selected main revision. Source code
is data: no candidate commands, hooks, workflows, tests, or package scripts execute
in the publisher. Only `aaron-howard` is currently allowed by trusted
`agents.remediation` policy; GitHub must also report User identity and live write,
maintain, or admin permission. Repository text and payloads cannot add callers.

GitHub transport supplies `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_ACTOR`,
`GITHUB_REF=refs/heads/main`, and `GITHUB_RUN_ID`. These are trusted host inputs,
not an externally authenticated API. A local operator controls its host; writing a
JSON file alone does not authenticate a remote caller.

Supported requests:

- Manual workflow dispatch on main, with exactly `operation=format-json`,
  `source_branch=feat/...`, a full `source_sha`, and a JSON `path`.
- Repository dispatch type `factory-remediate`, with exactly those four
  `client_payload` fields, sent by an authorized human.
- A new PR comment containing exactly
  `/factory format-json feat/<branch> <40-character-SHA> docs/<file>.json`.
  The path may also be under src/ or tests/. The comment is fetched again and must
  match the event body and sender. The open PR must target main with the exact
  same-repository head branch/SHA. Fork PRs, ordinary issue comments, changed
  comments, bots, and unauthorized callers are denied.

Event documents are limited to 64 KiB. Input types and lengths are checked. Data is
never interpolated into shell source. Requests supply no command, action list,
cost quote, token, policy authority, or destination branch.

## Publication and exact revision checks

The existing runner independently enforces pinned paths, tools, retries, deadline,
byte/action limits, private evidence access, and spending. Its fixture reservation
is synthetic accounting, not vendor billing. No unknown-cost vendor is enabled.

Credentials are separate: `FACTORY_GITHUB_TOKEN` reads authorization evidence,
`FACTORY_PUSH_TOKEN` has Contents write, and `FACTORY_PR_TOKEN` is the dedicated
App installation with Contents read and PR write. A read token cannot publish.
The workflow uses its job token for branch writes and the existing App for the PR;
the App needs no permission expansion. An installation token triggers normal PR
checks; a job token used to author the PR would suppress those event chains.

A deterministic `feat/factory-remediation-<event digest>` branch starts at the
exact source SHA. The GraphQL createCommitOnBranch API commits the single-file formatting fix. An
unverified signature blocks PR creation. The CLI compares the exact resulting SHA
to its source, requires one modified file and one commit, and reads the committed
file at that SHA to verify precise token-preserving output. It rechecks source and
main authority before publication. Concurrent later changes cannot alter that
snapshot or authorize its merge.

The App PR targets main and includes the original source branch's changes as well
as the fix. Review the full diff. Returned App identity and head SHA are verified.
All exact-head Factory and native GitHub checks and an independent human review
remain required. Formatting validation alone is not workload or release evidence.
If initial approval checks remain failed after review, rerun Factory Human Review
and Factory Trusted Policy on the current head; #30 tracks automatic refresh.
Never auto-approve, auto-merge, or substitute chat approval for GitHub review.

## Replay, interruptions, and evidence

Event identity is its comment ID or stable run ID, excluding run attempt number.
Concurrency serializes an event; the private runner ledger prevents local scope
resets. Durable hosted replay verifies the deterministic branch's request digest,
sole source parent, exact diff/content, and sole App-authored PR. It rechecks caller
and revisions, then returns the prior PR without another runner attempt or write,
even when the PR is closed. Changed or ambiguous evidence fails closed.

Partially published branches require operator recovery. A hosted rerun with no
durable published scope stops before reservation: an ephemeral runner cannot prove
that an earlier attempt spent nothing. Do not delete a published branch and replay
its event to reset spending. Deliberately submitted new requests are separate
authorized scopes. No publication retry loop exists.

Reports contain caller, event ID, source/trusted/fix SHAs, policy/request digests,
bounded action digests and synthetic cost, PR URL, and outcome. Raw comments,
payloads, file contents, and tokens are omitted. Local evidence uses the runner's
private ACL and retention policy; use `prune-agent-evidence` as documented in
[bounded proposals](bounded-agent-proposals.md). No private artifact is uploaded.
Hosted files disappear with the runner. GitHub summaries/logs use repository access
and retention settings; commits and PRs persist as durable replay evidence. Release
attestation remains #14.

API calls have 15-second timeouts and 1 MiB response limits; operation counts are
fixed. Authorization jobs have five-minute limits and publication ten minutes.
The runner retains its independent trusted 60-second, 20-action, 64-KiB, $2
synthetic task limits. Interrupted publication is blocked and must be inspected.

## Protected hosted activation pending

The implementation ships inactive: `FACTORY_REMEDIATION_ENABLED` is unset.
Before activation, create environment `factory-remediation`, restrict deployments
to main, and require the owner's environment review. Store `FACTORY_APP_PRIVATE_KEY`
as an environment secret, never a repository secret. The PEM remains outside the
checkout. Keep existing repository scope and App grants. Enable the repository
variable only after verifying protections and landing the reviewed workflow.
A same-account manual caller may supply environment review; preventing self-review
would block this single-developer workflow. Environment review and PR review are
separate approvals.

The workflow does not provision or attest environment configuration. GitHub can
auto-create a missing environment without review, so verify configuration before
enabling the variable. Missing credentials fail closed. Administrators can alter
workflow/environment policy; immutable workflow trust and release attestation
remain #9/#14 limitations.

Local public CLI tests use a GitHub API boundary fixture, real Git repositories,
and Windows ACLs. CI repeats authorized, denied, and replay cases on hosted Linux.
These fixtures do not prove live event transport, deployed token permissions,
signed GraphQL commits, or environment enforcement. Keep #11 open until the
reviewed workflow is on main, protected credentials are configured, and live
authorized/denied requests prove one real App PR, zero abusive writes, exact-head
checks, and the human review/rerun mechanism.

References: [GitHub events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[GraphQL commit API](https://docs.github.com/en/graphql/reference/commits),
[collaborator permissions](https://docs.github.com/en/rest/collaborators/collaborators),
[App token action](https://github.com/actions/create-github-app-token), and
[environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

Live integration evidence: a temporary branch in the isolated governance integration
repository produced signed commit 40e509c21451611d777f11681ce8ebe51eecc774 through
GraphQL. Repeating its original expected-head mutation returned STALE_DATA without
a second commit. The temporary branch was deleted; main protections were unchanged.
The owner token was used for this test; deployed workflow-token behavior still
requires the protected hosted fixture.
