# Ticket #9 hosted evidence

On 2026-10-03 the private integration repository
[AJHMH/software-factory-governance-integration](https://github.com/AJHMH/software-factory-governance-integration)
was seeded at signed commit `d8adc99ac0765811f4b31a7de31edafd6936cdf5`.
Its authoritative Governance digest is
`6ba6ed5c1e650bd3dc7f0479e4924bf37ca672977eb7b1e23e970aa18267ec76`.

The public interface produced these externally observed results using the
administrator's existing local GitHub session:

| Scenario | Result |
| --- | --- |
| Bootstrap without `--apply true` | blocked before writes |
| Complete bootstrap | passed; managed ruleset `24435460` active, no bypass |
| GitHub effective branch rules | deletion, non_fast_forward, required_signatures, required_linear_history, pull_request, required_status_checks |
| Remove required_signatures in the integration ruleset | blocked with the exact missing-signature remediation |
| Restore original ruleset in finally | passed, no drift |
| Repeat bootstrap with unrelated tag ruleset `24435503` | passed; unrelated ruleset response unchanged exactly |
| Direct signed push to integration main without a reviewed PR | rejected by GitHub with GH013; PR required and all eight required checks expected |

Production rulesets were not weakened. The integration ruleset remains active
and restored. It requires all eight named checks and one current human approval.
The integration repository does not have the proposal App installed and is not
a replacement production repository.

The scheduled/manual inspector was also exercised with the default read-only
workflow token: [run 37163808665](https://github.com/AJHMH/software-factory-governance-integration/actions/runs/37163808665).
GitHub omitted bypass actors, so inspection was blocked rather than reporting
false compliance. The error now explicitly requests Administration read scope.
The dedicated read credential has not been configured. Local inspection using
the existing administrator session verifies compliance; the default workflow
token cannot establish complete bypass visibility.

Team-plan status checks identify an integration, not an immutable workflow.
Trusted base checkout prevents candidate evaluator execution in the trusted job,
but check-name spoof prevention and authenticated retained evidence still need
a required-workflow entitlement or separately scoped trusted publisher. Fork
permission and runtime rejection probes are not claimed as verified by these
configuration checks beyond the direct-push denial above. See [operator guide](repository-governance.md).

PR #28 landed the protection tools and trusted base human-review workflow as
`04993026f68910c6ad3eeab6aac5d5d1227d9d9e`. This documentation follow-up exercises
that workflow on a subsequent proposal before production activation. The owner
must approve this proposal's exact head; the agent then reruns the trusted job
to verify positive review evidence without executing candidate evaluator code.
