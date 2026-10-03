# Interim PR checks and restoration plan

The factory owner approved informational reporting for incomplete Factory policy
and security integrations while PRs use GitHub-native CodeQL, code quality, and
secret scanning protections. These jobs report `not-run` or `unsupported`; their
successful process exit is not evidence that the unavailable gate passed.
Release certification continues to reject missing mandatory evidence.

Restore enforcement only after these tracked requirements are demonstrated:

- #6 implements pinned Gitleaks/OSV scans, exact-revision redacted findings, scoped
  dummy approvals, severity thresholds, and mandatory evaluated security CI.
  Safe denial fixtures execute in CI. GitHub-native protections remain enabled.
  See [security enforcement](security-enforcement.md) for scope and limits.
- #7 implements native exact-revision CodeQL severity evaluation and the required
  Factory SAST check. Hosted clean/prohibited-result evidence is recorded on the ticket.
- #8 adds independent human approvals for sensitive changes and exceptions,
  replacing the review status report with revision-bound evaluation. Its own
  policy is being adapted to the owner's solo-developer model: one authorized human
  (`aaron-howard`) approves proposals authored by a dedicated Factory GitHub App.
  Current PR #26 uses the owner's identity and requires replacement once the App
  is installed. The previous main policy still requires two approvals until an
  explicitly governed one-review policy bootstrap is adopted.
  Main now requires the evaluated human-review check and a native one-review
  minimum, retaining stale-review dismissal and existing protections. Hosted
  [missing-approval denial](https://github.com/AJHMH/software-factory/actions/runs/37157111221)
  and [coverage-decrease denial](https://github.com/AJHMH/software-factory/actions/runs/37157226374)
  were demonstrated on PR #26. The temporary uncovered source fixture is removed.
- #9: Configure and verify required checks/rulesets, including the trusted-policy
  workflow after bootstrap. Verify forks and attempted self-weakening in GitHub.
  Move Human Review's evaluator/workflow authority out of the candidate tree and
  verify approval revocation, updated bases, and merge-time revalidation. A trusted
  policy file alone does not prevent candidate evaluator/workflow tampering.
- #14: Combine these results into exact-revision release certification; keep
  publication disabled until every required capability is verified.

The trusted-policy workflow first becomes available after #4 lands on main.
Verify its successful execution and negative cases on a subsequent PR before
making it a required hosted check. Existing placeholder policy files outside
the execution pack still need enforcement through their corresponding tickets.

## Hosted trusted-policy verification

PR #23 exercised the bootstrapped trusted-policy workflow on October 3, 2026.
A temporary candidate raised its own policy/profile limit to 600 seconds and its
install command timeout to 240 seconds. The base evaluator retained the trusted
120-second profile limit and rejected the candidate without executing its commands.
[Denial evidence](https://github.com/AJHMH/software-factory/actions/runs/37144523856).
The probe is restored before landing; final passing checks are recorded on
[PR #23](https://github.com/AJHMH/software-factory/pull/23).
This verifies the workflow boundary; #9 still must make evaluated gates required
and verify drift, forks, and the broader governance settings.
