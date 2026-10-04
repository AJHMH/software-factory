# Bounded proposed changes

Ticket #10 adds a vendor-neutral broker, not an autonomous merge or shell agent.
The current fixture adapter supplies structured file requests. Repository, issue,
log and file contents are untrusted data: none become instructions for the host,
shell commands, dynamically imported code, policy overrides or budget settings.
Arbitrary tools, vendor processes, commits, approvals, merges, network requests
and paid model calls are unavailable. Remediation integration remains #11.

## Public interface

```powershell
node '<trusted checkout>/scripts/factory-validation.mjs' propose-change `
  --trusted-repo '<trusted checkout>' --trusted-revision '<full SHA>' `
  --repository-path '<source checkout>' --proposal '<proposal.json>' `
  --state-dir '<external private state directory>' `
  --scope-id '<operator-assigned PR/task ID>' --actor '<operator-assigned identity>'
```

Run the broker and its schemas/dependencies from a trusted Factory checkout.
Pinning policy does not make a candidate-modified broker trustworthy. The
operator controls its host environment, tool installations and launch arguments.
The operator selects the trusted policy commit and stable scope, actor and state
directory. These are authorization inputs, not fields the agent chooses. Reuse
the same scope/state for repeated requests and retries for one approved task.
Do not create a new scope or clear state to evade an exhausted budget. Replacing
that authorization requires an explicit human decision. This local caller
identity is not a cryptographic identity attestation (#14).

```json
{
  "version": "1.0",
  "adapter": "fixture",
  "actions": [{"tool": "write_file", "path": "src/example.mjs", "content": "export const value = 1;\n"}],
  "context": {"issue": "Untrusted task description"},
  "fixture": {"failures_before_success": 0, "delay_ms": 0}
}
```

Only `write_file` is permitted. The trusted `agents.runner` policy provides
allowed prefixes, restricted prefixes, retries, duration, spending, action/byte
limits and retention. Built-in restrictions always deny Git metadata, Factory
workflows/policies/evaluators/schemas/profiles and production infrastructure.
Paths are portable ASCII names; traversal, absolute paths, backslashes, Windows
device names, alternate streams, duplicate case-insensitive paths and trailing
dots are rejected. Batches are checked completely before proposal writes.

The fixture is the only adapter with a known execution/cost contract. Its fixed
per-attempt micro-USD charge is a synthetic reservation for deterministic tests,
not an external vendor bill. Unknown adapters stop without vendor execution or
billing. Future provider adapters must return data through this same broker and
have a trusted worst-case price; accepting a model's claimed cost is insufficient.
An arbitrary vendor executable is not an adapter supported by this boundary.

## Isolation, budgets and cancellation

The source repository is read as committed Git data and never changed. Only
allowed regular source files are copied into a separate private workspace, with
caps of 1 MiB and 1,000 snapshot files. No hooks, package scripts or workload code
execute. The broker, not the proposal, owns filesystem writes. Symlinks and
unsafe output files are rejected. This is a data/tool broker; it does not claim
to sandbox arbitrary hostile native code. A future executable agent needs a
separate OS/container isolation boundary before it can be enabled.

State must be outside the source repository. New Windows state gets an ACL for
the current Windows SID only; existing ACLs are verified. POSIX state must belong
to the current user with no group/other access. OS administrators remain capable
of overriding host controls. State is not an artifact to upload publicly.
Keep it outside all Git repositories and backup/sharing destinations unless
those destinations have the same intended access controls.

Each stable scope has an exclusive lock and a persistent ledger. A retry reserves
its full fixed cost before the adapter attempt, including failed attempts.
Retries do not reset the task deadline or spending ceiling. Identical terminal
requests return the recorded result; changed requests/policies/identities cannot
reuse that scope to obtain new writes. Concurrent or interrupted runs fail closed.
A crash reservation remains charged; a stale lock requires operator recovery,
not an automatic reset. Partial private outputs from a failed task are not valid
proposals and must not be applied or committed.

Use `--cancel-file <operator-controlled path>` to cancel before or during a task;
SIGINT and SIGTERM are also handled. Checks surround adapter waits and writes.
Host initialization is bounded by Git/ACL subprocess timeouts; the task deadline
covers snapshot collection, adapter attempts and actions. Filesystem calls can
have normal OS scheduling latency; a deadline overrun fails the outcome and does
not authorize use of partial output. No arbitrary long-running tool is available.

## Redacted audit and retention

The JSON report records actor/scope, source and trusted revision, policy/proposal
digests, actions with content digests, attempts, reserved cost, outcome and expiry.
It never logs context, proposed file contents, raw exceptions, keys or tokens.
The private workspace contains proposed file contents and is protected accordingly.
The ledger is durable local audit evidence, not an authenticated release certificate.

```powershell
node '<trusted checkout>/scripts/factory-validation.mjs' prune-agent-evidence `
  --trusted-repo '<trusted checkout>' --trusted-revision '<full SHA>' `
  --state-dir '<external private state directory>'
```

Schedule cleanup at least daily using an authorized host operator. Cleanup locks
each scope and removes expired workspace contents and action details. Minimal
identity/policy/digest/cost/replay reservations remain indefinitely so retention
cannot restore an exhausted budget. Active locks are skipped; links or malformed
state block cleanup. Scope IDs should be opaque identifiers without personal data.
The current policy retains detailed evidence for 365 days; adopters can choose a
shorter reviewed retention period. Neither command uploads evidence.

Public-interface tests exercise permitted writes, independent path/tool denials,
attempt/spend/time limits, cancellation, candidate policy weakening, replay,
redaction and expiry. The normal Factory safety job runs them in GitHub. Vendor
costs, provider integration, remote authenticated retention and arbitrary-agent
isolation are not claimed by this controlled fixture.
