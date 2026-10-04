# Local human-gated publisher

The owner selected local publication for ticket #11 because GitHub Team does not
support required environment reviewers in this private repository. The App PEM
stays in `D:\keystore`. No repository/environment secret, hosted writer job, plan
upgrade, or App permission expansion is required.

The public `local-remediate` command authenticates the human through GitHub's
`/user` API, constructs a local manual request, and reuses the existing live
authorization and independently bounded runner. Only trusted-policy callers with
current write/maintain/admin permission may prepare a fix. Local request IDs use
a separate event namespace from hosted dispatches/comments.

Preparation loads no App key and makes no remote writes. Inspect the private
workspace's single-file diff against the exact source SHA, then deliberately pass
`--approve true` and its exact `proposalDigest` to publish. These flags express
local operator intent; they are not GitHub review evidence or a cryptographic
proof that a human ran the command. Agents may invoke them only for requests the
human has authorized. They never satisfy the independent PR approval gate.

```powershell
$env:FACTORY_GITHUB_TOKEN = gh auth token
try {
    $FactoryArgs = @(
        '--repository', 'AJHMH/software-factory',
        '--trusted-repo', '<trusted checkout>',
        '--trusted-revision', '<current full main SHA>',
        '--repository-path', '<source checkout at exact source SHA>',
        '--source-branch', 'feat/<source branch>',
        '--source-revision', '<full source SHA>',
        '--path', 'docs/<file>.json',
        '--request-id', '<stable numeric request ID>',
        '--state-dir', 'D:\keystore\factory-state'
    )
    node scripts/factory-validation.mjs local-remediate --mode prepare @FactoryArgs
    # Review the actual private workspace diff; copy proposalDigest from the report.
    node scripts/factory-validation.mjs local-remediate --mode publish @FactoryArgs `
        --approve true --expected-proposal-digest '<reviewed digest>' `
        --private-key-path 'D:\keystore\ajhmh-software-factory.2026-10-03.private-key.pem'
} finally {
    Remove-Item Env:FACTORY_GITHUB_TOKEN -ErrorAction SilentlyContinue
}
```

Use reviewed tooling/dependencies from main for routine operations. The token is
obtained from the existing signed-in GitHub CLI account and held only in memory.
Never copy it or the PEM into a command argument, event file, log, or environment
file. The example's environment variable exists only for the process session.
Default App ID is 5180250 and installation ID 167664341; explicit numeric overrides
are available for template adopters. The same request ID/source/digest must be
retained across prepare/publish/replay. The source checkout is never modified.

Missing approval, a mismatched digest, denied authorization, or a stale source or
main revision stops before key loading or publication. A symlinked/hard-linked key,
key inside any source/trusted/tooling repository, non-RSA key, oversized key, or
missing installation scope is denied. Preserve OS access controls on the keystore;
the CLI is a trusted operator tool, not a sandbox against a compromised local host.

After approval the key creates a short-lived JWT and repository-scoped installation
token with Contents read / PR write. The human token performs the signed GraphQL
commit; the App authors the PR. No candidate command runs with either credential.
The token is revoked after use when GitHub is reachable and otherwise expires in
one hour. Environment changes are restored; credentials are never printed/stored.

The local gate re-prepares against current live authority before comparing the
reviewed digest. Preparation's reserved scope is reused without another adapter
charge. A durable exact PR replay uses existing evidence before key loading and
makes no new writes. Interrupted publication preserves its branch/ledger and
requires operator recovery rather than overwriting or resetting the scope.

GitHub manual/dispatch/comment workflows remain read-only authorization entry
points. They do not publish or consume local App credentials. An operator may
inspect an authorized request and prepare its explicit branch/SHA/path locally;
the local publisher authenticates and authorizes that operator independently.
It does not claim to automatically consume a hosted run or inherit its approval.

Existing full exact-head checks and current independent owner review still govern
the App-authored PR. The source branch's original changes are included, so review
the full diff. No mode submits an APPROVE review, auto-merges, or certifies a
release. Refresh the current-head Human Review and Trusted Policy checks after
review while #30 remains open. Keep published event branches for durable replay
evidence; deleting them requires manual recovery, not a new request to reset cost.

See [authorized remediation](authorized-remediation.md) for supported repairs,
input limits, token-preserving formatting, fork denial, audits, retention, and
failure semantics. Release attestation and immutable central tooling remain #14/#9
follow-ups. Local identity, host PATH, filesystem, tooling, and authenticated
operator control are part of this trusted-host boundary.
