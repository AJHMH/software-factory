# Release certification

`factory-validation.mjs certify` is the release authorization gate. It does not publish a GitHub Release or deploy. It certifies only a merged pull request whose complete evidence refers to its exact head revision.

The operator supplies a JSON bundle containing the original public Factory reports for `validate`, `policy`, `coverage`, `security`, `sast`, and `human-review`. The validation report must be the same report embedded in the verified build artifact. Every report must pass, use the selected trusted policy commit where applicable, and include the evaluator's evidence digest (validation uses its contract digest). The command independently verifies the downloaded artifact and SPDX SBOM, then checks the human-review report's approval count and identities against live GitHub review history.

Certification also queries GitHub live. Set `FACTORY_GITHUB_TOKEN` to a read-only token with Contents, Pull requests, Checks, Issues, and Administration/rulesets read permissions. The proposal-creation App has no ruleset permission; use a separate read-only operator token for certification. The pull request must be merged into `main` at the bundle revision; every required check from trusted Governance must have completed successfully for that SHA and expected GitHub App; a current independent human approval with write access must exist; and the live protection rules must pass Governance evaluation.

An open defect is an open GitHub issue with the `defect` label. It must have exactly one supported severity label: `severity:critical`, `severity:high`, `severity:medium`, or `severity:low`; missing or ambiguous severity blocks certification. The trusted Quality policy sets the zero-count severity and medium/low limits. Dependency registry, lockfile, and SBOM metadata are compared with trusted dependency policy. If trusted policy configures a maximum dependency age or required provenance attestation, certification blocks until the artifact carries metadata that can prove that requirement.

Exception evidence must identify its approver and a valid, unexpired expiry time. Where multiple gate reports refer to the same exception, the approver and expiry must agree. Coverage evidence must also name the pull request's actual base revision, so an old comparison cannot certify a newer merge.

The evidence bundle format is defined by `schemas/release-certification.schema.json`. Store the JSON output from the `validate`, `policy`, `coverage`, `security`, `sast`, and `human-review` evaluators under the matching keys in `reports`; preserve each report's revision, trusted-policy revision, evidence digest, and policy digest. For `validate`, use the exact JSON report that is embedded in the verified artifact's `validation-evidence.json`. The coverage report must include its full `baseRevision`.

Example invocation:

```powershell
$env:FACTORY_GITHUB_TOKEN = '<read-only GitHub token>'
node scripts/factory-validation.mjs certify `
  --repository AJHMH/software-factory `
  --pull-request <merged-pr-number> `
  --trusted-revision <40-character-trusted-policy-commit> `
  --evidence tmp/release-evidence.json `
  --artifact-directory tmp/downloaded-release-artifact `
  --output tmp/release-certificate.json
```

The JSON certificate records repository, pull request, source and trusted revisions, policy/evidence digests, approvers, open-defect counts, check contexts, exception references, artifact digest, SBOM digest, and certification time. A blocked attempt emits gate reasons and writes no certificate.
