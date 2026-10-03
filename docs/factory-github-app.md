# Factory identity for a solo developer

The repository owner, `aaron-howard`, is the sole authorized human approver.
Both normal and sensitive changes require one current approval. The factory
creates PRs as a dedicated GitHub App bot; the owner reviews them as a human.
Git commit signatures and PR authorship are separate: local commits can retain
the owner's GPG signature while the App authors the PR.

GitHub forbids authors from approving their own PRs. Creating a PR with the
owner's `gh` login makes the owner its author even when an agent wrote the code.
Use an App installation token, never an App user token acting as the owner.
The gate still rejects bots, self-approval, stale/dismissed reviews, and missing
approvals. Chat approval is not recorded as a GitHub review.

## Registration and installation

The private `AJHMH Software Factory` App is registered under AJHMH:
App ID `5180250`, slug `ajhmh-software-factory`, bot `ajhmh-software-factory[bot]`.
[App settings](https://github.com/organizations/AJHMH/settings/apps/ajhmh-software-factory).
Homepage: `https://github.com/AJHMH/software-factory`.
Disable webhooks and user OAuth authorization; this App is an API identity.
Limit installation to this account and select only `software-factory`.
Registration, key generation, and installation are complete. Installation ID
`167664341` is limited to `AJHMH/software-factory`. Live installation authentication
was verified on 2026-10-03 with Contents read and Pull requests write permissions.

For the initial proposal identity, grant repository **Contents: read** and
**Pull requests: read and write**. Metadata read is implicit. No organization,
administration, secret, workflow, Actions, or ruleset permissions are needed.
PR write also exposes review APIs, but bot reviews cannot satisfy the factory's
human gate. Contents read prevents this token from pushing or merging changes.
Local signed branch pushes continue through the existing Git identity.

Record the App ID, installation ID, and bot slug. Generate the App private key
in GitHub and keep its PEM outside the repository in a folder accessible only
to your Windows account. Do not paste it into chat, commit it, or put it in an
environment file. Do not place the key in repository Actions secrets while
candidate workflow trust remains unresolved in ticket #9.

## Local proposal creation

PowerShell 7 helper `scripts/New-FactoryPullRequest.ps1` creates a short-lived
installation token in memory, scoped to this repository and the permissions
above. It does not change `gh`'s saved human login or print keys/tokens.

```powershell
./scripts/New-FactoryPullRequest.ps1 -AppId <id> -InstallationId <id> `
  -PrivateKeyPath '<external-key-path>' -VerifyOnly

./scripts/New-FactoryPullRequest.ps1 -AppId <id> -InstallationId <id> `
  -PrivateKeyPath '<external-key-path>' -Head feat/ticket-8-human-approvals `
  -Title 'Require current human approval' -BodyFile '<PR-body-file>'
```

Push the signed feature branch first. Inspect the returned PR author: it must be
the dedicated App's `[bot]` identity. Register that bot in `agent_accounts`.
Attach the resulting PR to the Codex task, wait for checks, and request the owner's
current-head GitHub review. Every subsequent push invalidates approval. Never
submit an APPROVE review through factory credentials, bypass checks, or interpret
App authentication as human approval.

## Ticket #8 bootstrap

PR #26 is already authored by `aaron-howard`; its author cannot be reassigned.
After App authentication is verified, replace it with an App-authored PR while
preserving its branch and evidence. Close the old PR only once the replacement
plan is ready; do not discard its commits or evidence.

Main still contains the previous two-review policy. A candidate policy cannot
reduce its own governing approval count. The owner-approved one-review policy
therefore needs an explicit governed bootstrap before this increment can land.
After the owner submits a GitHub APPROVED review on the replacement App-authored
PR's exact final head, verify the review identity and commit signature, then set
the administrative repository variable `FACTORY_REVIEW_POLICY_REVISION` to that
full reviewed SHA. This selects the owner-approved policy commit as authority;
the candidate cannot supply this variable through its contract or evidence.
Record the review ID and selected policy digest on the ticket. Re-run the review
check, verify its one current owner approval, and retain every other required
check and native review protection. Any head change requires a new owner review
before changing the pin. Delete the temporary variable after the merge so future
PRs again use base policy by default. No variable has been activated yet.

Keep required approval checks active while preparing that bootstrap; do not
silently change the evaluator to trust candidate policy. Ticket #9 continues
tracking authoritative workflow/evaluator distribution and merge-time checks.

Official guidance: [App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app),
[installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
and [required reviews](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).
