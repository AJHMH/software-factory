# Security & Threat Model

## Implementation status
Secret/dependency gates run pinned Gitleaks and OSV scans against committed source
and trusted policy. See [security enforcement](security-enforcement.md) for scope,
redaction, dummy approvals, and limits. SAST evaluation and certification remain
unsupported. Other controls below describe target requirements.

## Selected review sources
Use GitHub's native Security features for current code-quality and security review:

- **Security policy:** the repository's published security policy defines supported versions and reporting procedures; it is documentation, not an automated code check.
- **Dependabot alerts:** review dependency vulnerability findings and remediation status.
- **Code scanning alerts:** review static-analysis findings for the relevant source revision.
- **Secret scanning alerts:** review exposed-secret findings and their remediation status.

CodeRabbit review and uploads are not required or used for this project. Continue
local tests, typechecking, and manual review alongside GitHub's security signals.
These signals do not establish test coverage, architectural correctness, human
approvals, or a complete quality gate on their own.

Missing, disabled, inaccessible, or stale scanning results must not count as clean
checks. Local pinned scanners now supply secret/dependency evidence. Hosted CodeQL
evaluation and authenticated release evidence remain #7 and #14.

On October 3, 2026, read-only checks verified Code Security, Dependabot security
updates, and all exposed secret-scanning settings enabled. CodeQL and GitHub code
quality analysis passed on PR #22. The security policy is published. Factory security
now executes evaluated scans; review integration remains informational.
See [the restoration plan](governance-follow-ups.md)
for issues #6–#9 and #14. Release certification remains blocked.

## Threat Vectors
1. **Supply Chain Attacks:** Mitigated via strict Dependency policies (e.g., auto-updates, SCA scans).
2. **Credential Leaks:** Mitigated via mandatory pre-commit and CI secret scanning.
3. **Malicious Code:** Mitigated by the AI Review Agent and SAST scans.

## Governance targets
- The SOC2 policy flag is a configuration intention, not evidence of compliance.
- Audit retention of 365 days is a target; an audit store and retention enforcement are not implemented.
- Critical-path multi-party human review is a target; hosted approval enforcement follows in the governance tickets.
