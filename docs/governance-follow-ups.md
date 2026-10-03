# Interim PR checks and restoration plan

The factory owner approved informational reporting for incomplete Factory policy
and security integrations while PRs use GitHub-native CodeQL, code quality, and
secret scanning protections. These jobs report `not-run` or `unsupported`; their
successful process exit is not evidence that the unavailable gate passed.
Release certification continues to reject missing mandatory evidence.

Restore enforcement only after these tracked requirements are demonstrated:

- #6: Evaluate real secret/dependency findings, scanner availability and errors,
  and exact-revision evidence against trusted security policy. Then replace the
  security status report with a mandatory evaluated gate, with denial tests.
- #7: Enforce CodeQL finding severity and bind results to the current revision.
- #8: Verify independent human approvals for sensitive changes and exceptions.
  Replace the review status report with actual revision-bound review evaluation.
- #9: Configure and verify required checks/rulesets, including the trusted-policy
  workflow after bootstrap. Verify forks and attempted self-weakening in GitHub.
- #14: Combine these results into exact-revision release certification; keep
  publication disabled until every required capability is verified.

The trusted-policy workflow first becomes available after #4 lands on main.
Verify its successful execution and negative cases on a subsequent PR before
making it a required hosted check. Existing placeholder policy files outside
the execution pack still need enforcement through their corresponding tickets.
