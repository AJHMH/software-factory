# Automatic approval-check refresh

Ticket #30 refreshes the original required approval jobs after a current review
is submitted, edited or dismissed. It never approves, merges, changes protection,
creates a replacement check, or writes an approval verdict.

## Trust and request flow

1. `Factory Review Event` observes `pull_request_review` events with a read-only
   token. It performs no checkout, dependency installation, candidate execution or
   artifact upload. Its run title binds PR number, head, base and action.
2. `Factory Approval Refresh` runs from the default branch on `workflow_run`.
   Its read-only resolver loads approved default-branch code and calls Factory
   Validation to check live run identity, PR identity, explicit trusted-policy
   human callers and current repository permissions. Candidate-controlled observer
   output is never interpreted as approval evidence.
3. The write job checks out only the resolved trusted base. Its token has contents
   and PR read plus Actions write; no contents, PR, checks, statuses or ruleset
   write permission is granted. It revalidates the live request before asking
   GitHub to rerun exact allowlisted approval jobs.
4. GitHub reruns those jobs under their original event SHA/ref and permissions.
   Their existing validators collect current independent approval evidence and
   can pass or fail. Revocation refreshes previously successful jobs as well.

The original workflow run titles bind PR/head/base even when GitHub's run API
returns an empty `pull_requests` array. The observer title is untrusted data;
service run metadata, live PR identity and the original trusted-policy run binding
must agree. Source/evaluator/policy authority remains the pinned trusted base;
the privileged worker never checks out or executes candidate content. The ordinary
read-only approval workflow also uses base evaluator code and candidate data.
The separate `pull_request_target` required approval job remains authoritative.

The candidate-defined read-only observer cannot produce a passing required check.
Candidate workflow names or output cannot select another privileged workflow/job.
The refresh worker accepts only the two original approval workflows and their
exact job names, current head/base, main target and same-repository source.
Fork refresh is unsupported and fails closed; a human can inspect and rerun the
existing trusted check without expanding the worker's authority.

## Public interface

Run from a reviewed Factory checkout at the exact current PR base, using a token
with the documented read scopes; `apply` additionally requires Actions write:

```powershell
node scripts/factory-validation.mjs refresh-approvals --mode inspect `
  --repository AJHMH/software-factory --trigger-run <review-observer-run-id> `
  --trusted-repo . --trusted-revision <exact-base-SHA>
node scripts/factory-validation.mjs refresh-approvals --mode apply `
  --repository AJHMH/software-factory --trigger-run <review-observer-run-id> `
  --trusted-repo . --trusted-revision <exact-base-SHA>
```

`inspect` is read-only and emits only validated numeric/hexadecimal workflow
outputs. `apply` preflights both original jobs before remote writes and rechecks
head/base, review history and caller permissions before each request. Reports
contain identifiers, a digest of normalized review metadata and requested job IDs.
Review bodies, tokens and raw failures are excluded. A request is not a passing
gate; only the rerun validator decides approval.

Requests and ordinary approval jobs for a PR are serialized without cancelling
another refresh. A completed job that began strictly after the
observer event is already current; timestamp ties are refreshed conservatively.
Queued/running jobs are given a bounded wait before requesting a new evaluation.
The original run inventory is bounded and incomplete/ambiguous evidence blocks
the operation. Replayed events do not continuously rerun fresh jobs. API failures
are reported as blocked; partial remote requests are listed, never reported as
successful approvals. No guarantee of immediate delivery follows from GitHub's
event queue or scheduler.

## Bootstrap and recovery

The worker becomes eligible only after its reviewed workflow/code lands on main.
The implementation PR therefore still uses existing human-review workflows and
may need the normal one-time manual refresh after actual GitHub approval. The
change cannot authorize or validate its own bootstrap. Subsequent PRs have bound
original run titles and can demonstrate automatic refresh.

Old runs without a binding, an outdated branch/base, unsupported fork source,
missing evidence, removed permissions or unavailable APIs fail closed. Inspect
the source, update stale branches through normal review, and rerun the genuine
checks when necessary. GitHub also limits the age of runs eligible for rerun;
create a fresh PR update if the original run is no longer eligible. Never suppress
required checks, manufacture an approval, or change bypass actors to recover.

Hosted verification must record an App-authored probe's exact head/base, the
owner's genuine current review, observer/worker runs, original approval run/job
IDs, and successful refresh without a manual rerun. Then demonstrate revocation
or head invalidation and confirm that approval cannot survive. Close an unmerged
probe and remove its temporary branch. Controlled REST fixtures test decisions;
they do not establish that GitHub delivered the hosted events.

GitHub contracts: [workflow events and default-branch worker](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[secure privileged workflows](https://docs.github.com/en/actions/reference/security/secure-use),
[rerun behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs),
[job rerun API](https://docs.github.com/en/rest/actions/workflow-runs).
