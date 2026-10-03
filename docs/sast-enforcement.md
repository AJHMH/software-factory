# Native CodeQL severity gate

Ticket #7 retains GitHub CodeQL default setup. The supported Node 24 profile selects
JavaScript/TypeScript and build mode `none` in trusted `profiles/codeql.yaml`; no
workload build or lifecycle script is required. GitHub manages the CodeQL version,
which is recorded from each actual analysis. Existing Actions analysis and native
security/quality/secret protections remain enabled.

```sh
node scripts/factory-validation.mjs collect-sast --trusted-revision <FULL_BASE_SHA> --repository <owner/repo> --ref refs/pull/<number>/head --output tmp/sast-evidence.json
node scripts/factory-validation.mjs sast --trusted-revision <FULL_BASE_SHA> --evidence tmp/sast-evidence.json
```

The collector requires `FACTORY_GITHUB_TOKEN` with read access to code scanning.
Supply it through GitHub Actions or an authenticated operator's process environment;
never put a token in a committed file. API calls use a fixed GitHub.com origin,
the versioned read-only API, request deadlines, response bounds, and no redirects.
GitHub Enterprise and other workload profiles are unsupported.

The collector waits at most four minutes for native default-setup CodeQL analysis
with the exact source SHA, ref, and profile category. It excludes Code Quality and
other analysis configurations. Errors, warnings about incomplete analysis, empty
query sets, unavailable permission/service, missing analysis, and mismatched SARIF
identity/result/query counts block delivery. A successful HTTP response or empty
alert list alone never establishes a clean scan.

SARIF provenance must name the source revision and repository. The query inventory
and tool version must match the analysis record. Security severity comes from the
actual rule's security-severity score: zero is none, below 4 low, below 7 medium,
below 9 high, and 9–10 critical. Missing/unknown rule severity fails closed. Trusted
`policies/security.yaml` currently blocks high/critical and reports medium warnings.
Candidate policy files cannot change that authority. Pre-#7 trusted revisions use
a fixed Node-24-only bootstrap profile, which grants no additional capabilities.

Reports retain revision/tree/contract identity, analysis ID, tool version, selected
language/build mode, trusted policy/profile/evidence digests, and actionable findings
(rule, severity, committed path, line, official query-help/source URL). Raw source snippets, messages,
tokens, and full SARIF are omitted. Findings include existing and dismissed results
present in the analysis; a dismissal does not change the trusted severity policy.
Policy failure differs from analysis/build error and unsupported capability.

The Factory SAST check has contents/read and security-events/read permissions, no
publication or mutation step, and checks out the exact head. Protected branches
must require `Enforce Factory SAST policy` from GitHub Actions; native CodeQL results
protection remains active. Forks without API access fail closed. Broader workflow
tamper protection and fork governance remain #9, human approvals #8, and authenticated
artifact storage/retention/composition #14. Caller-supplied JSON is consistency checked
and cannot by itself certify a release. Certification/publication remain blocked.

CI runs public-interface fixtures for clean findings, prohibited severities, warnings,
stale/unsupported evidence, analysis/build error, and inaccessible analysis service.
Hosted probe evidence and required-check configuration are recorded on ticket #7.
