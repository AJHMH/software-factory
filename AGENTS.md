## Agent skills

### Issue tracker
Issues and specs live in GitHub Issues for aaron-howard/software-factory.
See docs/agents/issue-tracker.md.

### Triage labels
Use the five canonical triage labels.
See docs/agents/triage-labels.md.

### Domain docs
Use a single-context layout with root CONTEXT.md and docs/adrs/.
See docs/agents/domain.md.

### Factory pull request identity

Create factory PRs using the dedicated `ajhmh-software-factory` GitHub App installation
identity, not the owner's saved `gh` login. The owner `aaron-howard` supplies the sole
required human review. Use `scripts/New-FactoryPullRequest.ps1` and the setup documented
in `docs/factory-github-app.md`; attach each created PR to the Codex task.
Never submit human approvals as an agent or substitute chat approval for a current
GitHub review. Missing App credentials block proposal creation; do not fall back to
an owner-authored PR or change required checks to get around that blocker.
