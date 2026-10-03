# Revision-bound coverage enforcement

The Node 24 profile measures tracked `.mjs` source files under the workload's `src/`
directory. Coverage is a mandatory Factory gate, separate from unit and integration
test results. It does not establish hosted review approval or release readiness.

## Public interface

```powershell
node scripts/factory-validation.mjs measure-coverage --base-revision <SHA> --trusted-revision <SHA> --output coverage/evidence.json
node scripts/factory-validation.mjs coverage --base-revision <SHA> --trusted-revision <SHA> --evidence coverage/evidence.json
```

Create the output's parent directory first. Both commands accept `--contract`,
`--trusted-repo`, and `--overrides`, as the policy interface does. Success exits 0;
missing, malformed, stale, inadequate, or out-of-scope evidence exits 1 with a blocked
report. Unsupported flags or duplicate options exit 2. No release can be certified
through these commands. `capability coverage` remains metadata and reports not-run.

## Policy and evidence

Thresholds come from `policies/quality.yaml` at the operator-selected trusted commit.
The strict Quality schema supports the existing numeric version `1.0` (parsed as
`1`) and the quoted version `"1.0"`; other versions, fields, and invalid types fail.
The profile applies `global_minimum_percentage` to both lines and branches and
`new_code_minimum_percentage` to changed lines and branches. Defaults are 80% and
90%. Line and branch percentages must not decrease from the selected baseline when
`allow_coverage_decrease` is false. Threshold comparisons use unrounded counts;
values exactly on the boundary pass.

The baseline must be a full commit SHA and an ancestor of the current workload HEAD.
The diff is computed directly from Git, with external diff/text conversion disabled;
it is never supplied by the evidence file. Added/modified lines are checked; a branch
is changed when its recorded source span intersects changed lines. With no changed
source lines/branches, that metric reports not-applicable with a null percentage.
Deleted files do not contribute candidate coverage; baseline totals still include them.

Evidence contains candidate and baseline revisions, workload/profile identity,
contract and source SHA-256 digests, per-file line hits and branch ranges/hits, and
separate revision-bound unit/integration outcomes and exit codes. Every tracked
source file must appear once. Missing line/branch data, negative counts, duplicate
branches, digest mismatches, missing test evidence, or stale revisions block the gate.
All physical source lines are represented, including unexecuted files. c8's V8
statement ranges determine hits; an unreported line is conservatively uncovered.
Coverage suppression comments are rejected unless trusted Quality policy permits
them. Lint and release-readiness fields are validated but remain separate gates.

## Node adapter

The pinned c8 adapter measures isolated copies of committed candidate and baseline
workloads. It never measures an uncommitted working-tree source file. Source digests
cover Git blob text, so Windows checkout line-ending conversion cannot make results
stale. Contract digests cover the exact selected contract file bytes.

Unit tests are `tests/*.test.mjs`; integration tests are
`tests/integration/*.test.mjs`. Each suite is executed and recorded separately;
aggregate coverage runs both suites together. Baseline coverage runs whatever suites
exist in that baseline; required suite checks apply to the candidate. The reference
workload's integration test exercises its API from a separate Node process.

The adapter explicitly sets c8 configuration, `--all`, source/include patterns,
extensions, and exclusions. Candidate c8 configuration cannot hide untested files.
Packages with runtime dependencies install through `npm ci --ignore-scripts`;
built-in-only reference tests need no install. Non-text assets, native builds,
alternative test layouts, and other languages require a future profile adapter.
Commands have timeouts and owned process-tree termination. Scratch paths remain
inside the workload repository's ignored `tmp/` directory and are verified before
cleanup. Unit/integration failure, missing baseline tests, scanner failure, or timeout
cannot become a clean coverage result.

## Exceptions

The existing trusted approval ledger validates every exception's identity, reason,
scope, approver, owner, expiry, and exact contents. Coverage exceptions additionally
require the exact `base_revision`. Supported rule names are
`coverage.global_minimum_percentage`, `coverage.new_code_minimum_percentage`,
`coverage.allow_coverage_decrease`, `coverage.require_unit_tests`, and
`coverage.require_integration_tests`. Threshold values are percentages 0–100;
other values are booleans. Use [the approval procedure](policy-evaluation.md).
Owner and approver must be independent; approval expires after at most 30 days.
All triggered requirements need matching exceptions: lowering a global threshold
does not automatically waive a coverage decrease or required test suite.

## GitHub boundary

`factory-coverage.yml` checks out the exact PR head SHA with full history. The PR
base SHA supplies both baseline and governing policy; main pushes use the previous
main SHA. These values enter the CLI through environment variables. Coverage runs
only in a read-only candidate job, never the privileged `pull_request_target`
trusted-policy job. The report binds metrics to all three revisions and an evidence
digest. Evidence files can be emitted for inspection; their authenticity must be
verified independently before future release certification (#14).

The replay command checks consistency and policy, not cryptographic authenticity of
arbitrary caller-supplied hit counts. Use adapter-produced evidence from trusted
validation runs. Hosted required-check/ruleset enforcement and tamper-resistant
evidence retention remain tracked in #9 and #14; this change makes the CLI and CI
coverage gate fail, and does not provision branch protection settings.
