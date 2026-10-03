# Secret and dependency gates

The Node 24 profile runs checksum-pinned Gitleaks 8.30.1 and OSV-Scanner 2.6.0
alongside GitHub security features. GitHub manages its scanner versions; its secret
scan history does not identify an exact commit. This adapter supplies explicit tool
versions and committed-source evidence.

```sh
npm ci --ignore-scripts
node scripts/install-security-tools.mjs
node scripts/factory-validation.mjs scan-security --trusted-revision <FULL_TRUSTED_SHA> --output tmp/security-evidence.json
node scripts/factory-validation.mjs security --trusted-revision <FULL_TRUSTED_SHA> --evidence tmp/security-evidence.json
```

Optional `--contract` selects a committed contract, `--trusted-repo` selects the
trusted repository, and `--tools-dir` selects binaries with the required hashes.
The adapter snapshots the entire committed Git tree; uncommitted changes are excluded.
Gitleaks checks committed regular files. OSV checks all packages, including development
and optional dependencies, in the contract workload's npm lockfile. No workload code
is installed or executed. Factory tooling dependencies are separate from this scope.

Windows x64 and Linux x64, lockfile version 3, and packages resolved from
`https://registry.npmjs.org/` are supported. Symlinks, submodules, other registries,
missing locks, and oversized/unreadable files cannot pass. OSV needs network access;
connection errors block. Vulnerability databases change even with pinned executables.

Official release artifacts and extracted binaries have pinned SHA-256 hashes. Binary
hashes and reported versions are checked on every scan. Candidate configuration,
ignore lists, and Gitleaks suppression comments cannot suppress findings. Scanners
receive no GitHub token or inherited scanner configuration. Execution is bounded;
captured scanner stdout/stderr is never printed. Temporary snapshots/reports are removed.

Trusted `policies/security.yaml` controls secrets; trusted `policies/dependencies.yaml`
supplies vulnerability thresholds. Current policy denies any unapproved secret and
vulnerabilities above **low**. Unknown severity is conservatively critical. Reports
distinguish clean scans, findings, errors, and unsupported capabilities. Exit codes and
complete package inventories are checked; missing, malformed, stale, or unavailable
evidence cannot pass mandatory gates.

Evidence binds the source SHA, Git tree SHA, committed contract digest, profile,
workload identity, and tool versions. Secret findings contain only rule, path, line,
and full-file digest. Credential values, matching text, and raw logs are excluded.
Dependency findings contain package, advisory ID, and severity. Evaluated reports
also identify trusted policy/evidence digests.

## Approved dummy test credentials

Allowing dummy secrets does not exempt an entire test directory. Every finding needs
an independent approval in trusted `policies/security-dummy-approvals.json`. Records
contain exactly these fields:

```json
{
  "revision": "<full candidate SHA>",
  "workload_id": "<contract workload ID>",
  "path": "examples/reference-workload/tests/dummy.txt",
  "rule": "<Gitleaks rule ID>",
  "line": 1,
  "source_digest": "<SHA-256 of complete committed file>",
  "owner": "workload-owner",
  "approver": "<authorized enforcement-policy approver>",
  "reason": "Synthetic test fixture only",
  "approved_at": "<UTC timestamp>",
  "expires_at": "<UTC timestamp within 30 days of approval>"
}
```

Revision, workload, file, rule, line, and digest must match. The authorized approver
must differ from the owner. Approval must be current and last at most 30 days. Only
the selected workload's `tests/` subtree qualifies; production credentials never do.
Missing ledgers on pre-#6 trusted revisions mean zero approvals for safe bootstrap.
Candidate approval files have no authority; approved records belong on a separate
trusted revision selected by an authorized operator.

## Hosted behavior and remaining work

Security CI scans the exact PR head using base policy. Pushes use prior-SHA policy;
scheduled/manual runs use current-SHA policy. The workflow has only `contents: read`
and fails denied/unavailable gates. CI runs real safe denial fixtures with
`FACTORY_SECURITY_INTEGRATION=1`. Local tests omit these network tests unless that
environment variable is set after scanner installation.

Caller-supplied JSON is checked for consistency, not authenticity. Authenticated
evidence storage, retention, and composition remain #14. Required checks and protection
against candidate workflow/evaluator weakening remain #9. SAST enforcement is #7;
human review is #8. Supply-chain age, SBOM, and broader policy declarations are outside
this secret/vulnerability gate. Certification and publication remain blocked.
