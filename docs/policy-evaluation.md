# Trusted policy evaluation

Ticket #4 introduces a versioned execution-policy pack, profile constraints, and
approved exceptions. The supported rule is `maximum_command_timeout_seconds`.
Other quality, security, agent, review, and release policy declarations are not
evaluated by this operation; their gates remain unavailable until implemented.

Run `node scripts/factory-validation.mjs policy --trusted-revision <full-commit-SHA>`.
Optional flags are `--trusted-repo <repository>`, `--contract <file>`, and
`--overrides <file>`. Default repository is the current directory; default contract
is `factory-contract.yaml`. Omitted overrides mean no exceptions. Invalid arguments
exit 2; malformed input or denied policy exits 1 with `blocked`; satisfied execution
policy exits 0 with `passed`. No workload commands, merges, or releases execute.

## Trust and precedence

The invoking governance owner must select a reviewed, immutable trusted commit.
Branch names, tags, missing commits, and non-commit objects are rejected. The local
CLI cannot determine whether an arbitrary caller-selected SHA is authoritative:
the invocation itself must be trusted. Never take this selector from a contract,
exception, candidate workflow, or PR-provided configuration.

Both `policies/enforcement.yaml` and `profiles/workloads.yaml` are read with Git
from that commit, ignoring corresponding files in the proposed working tree.
Their schemas, the contract schema, and exception schema are validated before
evaluation. Unknown fields and unsupported versions/profiles are rejected.
The effective timeout is the minimum of the factory baseline and selected profile
limit. The committed sample uses 300 and 120 seconds respectively. A scoped,
approved exception then replaces that limit, within the schema's absolute 600
second bound. Multiple exceptions to the same rule are rejected, even if identical.

JSON evidence includes trusted and workload revisions, policy/profile/contract
SHA-256 digests, dirty working-tree status, effective policy, applied exceptions,
and a gate outcome. Policy/profile hashes cover the Git text after trimming;
contract hashes cover exact file bytes. Dirty work is allowed for local evaluation
and identified in evidence; it cannot establish release readiness.

## Approval procedure

1. Prepare a version `"1.0"` override document with an `exceptions` array.
2. Each exception requires `id`, `rule`, `value`, `workload_id`, `profile`,
   `revision` (the exact workload commit SHA), `contract_digest` (exact contract file
   SHA-256), `reason`, `owner`, `approver`, `expires_at`, and `evidence_id`.
3. An independent governance approver listed in the trusted pack's
   `exception_approvers` reviews the scope and reason. Owner and approver must differ.
   Dates use UTC ISO timestamps with milliseconds, such as
   `2026-10-04T12:00:00.000Z`. Approval must precede expiry and not be in the future;
   expiry must still be current and at most 30 days after approval.
4. Record an approval in a separately reviewed policy commit's `approvals` array:
   `evidence_id`, `approver`, `exception_digest`, and `approved_at`.
   `exception_digest` is SHA-256 of `JSON.stringify(exception)` after parsing the
   override document, preserving property order. Reordering or altering fields
   requires reapproval. The trusted approval ledger is the approval evidence;
   adding an approver name or record in a candidate checkout supplies no authority.
5. Pin that governance commit and evaluate the candidate with the override file.
   The approval ledger is independently revisioned; candidate commit and trusted
   policy commit need not match. Duplicate evidence IDs, scope mismatch, forged
   approval, expired evidence, and conflicting exceptions fail closed.

The policy ledger represents governance approval of an exception, not GitHub PR
review identity verification. Hosted human approval, restricted paths, required
checks, and merge/release authorization remain separate capabilities.

## GitHub boundary and bootstrap

`factory-policy.yml` uses `pull_request_target` so the workflow definition comes
from the trusted base. Its token is read-only and checkout credentials are not
persisted. It checks out the event's base SHA into `trusted`, and the exact head
SHA into `candidate`. Only base evaluator code and dependencies run. Candidate
contract and exception files are parsed as data; candidate commands, dependencies,
scripts, and actions are never executed in this job. The policy SHA is supplied
through an environment variable from GitHub event metadata, never shell source.

The governance owner must review and merge the initial evaluator, schemas, pack,
and workflow before this hosted gate can run. It cannot securely approve its own
bootstrap PR. Existing Agent Review reports unavailable status because hosted human-review
evidence is not implemented; release certification remains fail-closed. Adding this workflow does not configure required checks
or make certification pass; protections and hosted integration validation follow
their own tickets. A policy change takes effect only after governance-approved
landing changes the trusted base for subsequent PR events. Existing PRs need a new
event to reevaluate against updated base policy.

## Interim PR integration reporting

Incomplete Factory security and review jobs report unavailable status without
failing PRs. GitHub-native protections remain active; release certification remains
blocked. See [the restoration plan](governance-follow-ups.md) for tracked follow-up tickets.
