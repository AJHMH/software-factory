# Repository protection and drift

The public Factory Validation interface reads the Governance policy from a full
operator-selected trusted Git commit. Candidate edits cannot replace that policy.
The protection pack requires signed commits, linear history, prevention of
deletion and force pushes, current human reviews with stale approval dismissal,
resolved review threads, and named up-to-date checks from the GitHub Actions App.
At least one applicable active ruleset without bypass actors must enforce each
control. A separate bypassable ruleset cannot weaken an unbypassable one.

```powershell
$revision = git rev-parse main
# Supply an existing token in FACTORY_GITHUB_TOKEN without printing it.
node scripts/factory-validation.mjs collect-governance --repository AJHMH/software-factory --trusted-revision $revision
node scripts/factory-validation.mjs bootstrap-governance --repository AJHMH/software-factory --trusted-revision $revision --apply true
```

`collect-governance` performs only GET requests. A daily default-branch workflow
and manual dispatch repeat this check. `governance --evidence <snapshot.json>`
supports offline inspection, explicitly reporting that a supplied snapshot does
not establish live enforcement. Collection includes inherited organization rules,
full ruleset details and bounded pagination. API access or entitlement failures
block the result with an actionable message; they never imply enforcement.
GitHub can withhold bypass actors from `GITHUB_TOKEN` responses. In that case the
scheduled job fails closed. Configure `FACTORY_GOVERNANCE_READ_TOKEN` with only
repository-scoped Administration read permission for complete inspection, or run
the command locally with an authorized administrator. A GET-only inspector does
not need administration write; do not give the workflow a bootstrap token.

Bootstrap is opt-in. It creates or updates only the repository ruleset named
`Factory governed default branch`, requiring administration write access. Existing
tag, push, security, quality and other rulesets remain untouched. Within the
managed ruleset it retains unrelated rules and parameters, additional checks,
and higher review counts. Managed bypass actors are removed, and its conditions
are reset to the default branch. Duplicate managed rulesets fail closed. A fresh
GET verifies effective controls after writing. No agent/App bypass is granted.
The proposal App continues to have no administration permission.

## Trusted human review

`factory-policy.yml` runs the human evaluator from the PR base in a
`pull_request_target` job. It checks out the exact candidate only as data, installs
only trusted dependencies, and never runs candidate code. The collector verifies
live head/base identity and reviews again before producing a result. The candidate
review workflow remains a convenient review-event signal, while the additional
trusted job is required after it is available on main.

After an owner review or dismissal, rerun the **Factory Trusted Policy** workflow
for that PR to refresh its trusted human check. A new head already triggers a new
run. If the base changed, synchronize/update the PR and obtain a new current
evaluation; a stale run is rejected. Native review requirements and strict
up-to-date checks provide GitHub's merge-time protection. The agent must inspect
all required checks and the current head immediately before a conditional merge.

## Limits and bootstrap order

GitHub Team supports these repository rulesets, but checks pinned to the Actions
integration do not attest a specific workflow's identity. Administrators can
change protections, and workflows with write access can attempt to spoof a named
check. Preventing that needs organization-enforced required workflows where
entitled, or a separately scoped trusted check publisher. This implementation
reports configuration compliance, not an atomic authorization certificate or
proof against administrators. Do not treat it as release certification (#14).
Fork checks need Actions access and fork approval where GitHub requires it;
missing evidence fails closed. Native CodeQL/quality/secret scanning remain
separate protections and are preserved by bootstrap.

First land the trusted workflow, then verify it on a subsequent PR before making
its new check required. Requiring a check absent from the default branch would
deadlock the introduction. Ticket #9 uses the private integration repository
`AJHMH/software-factory-governance-integration` to verify the setup, weaken its
managed controls, detect drift, and restore compliance. Production protections
must never be weakened for these tests.

References: [ruleset API](https://docs.github.com/en/rest/repos/rules),
[secure pull_request_target use](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).
