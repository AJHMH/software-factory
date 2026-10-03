# Security & Threat Model

## Implementation status
The controls below are target requirements, not implemented guarantees. Security
gates currently report unsupported and block certification; no secret, dependency,
or SAST scan is performed by the scaffold. See [capabilities](capabilities.md).

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
checks. Actual alert evaluation and revision-bound enforcement are implementation
work in issues #6, #7, and #14.

On October 3, 2026, after the factory owner enabled GitHub Security features,
read-only API checks verified Code Security, Dependabot security updates, and
secret scanning enabled. Dependabot and secret scanning each reported zero open
alerts. CodeQL default setup remained `not-configured`, and the code-scanning
APIs reported no analysis found. Secret scanning push protection, non-provider
patterns, validity checks, AI detection, and delegated dismissal remained disabled.
GitHub still reported no published security policy; the policy is committed locally
but has not been pushed. Recheck these settings after configuring analysis and
pushing changes. The zero-alert counts are not a clean scan of unpushed local code,
and enabled hosted features do not implement the Factory's alert-enforcement gates.

## Threat Vectors
1. **Supply Chain Attacks:** Mitigated via strict Dependency policies (e.g., auto-updates, SCA scans).
2. **Credential Leaks:** Mitigated via mandatory pre-commit and CI secret scanning.
3. **Malicious Code:** Mitigated by the AI Review Agent and SAST scans.

## Governance targets
- The SOC2 policy flag is a configuration intention, not evidence of compliance.
- Audit retention of 365 days is a target; an audit store and retention enforcement are not implemented.
- Critical-path multi-party human review is a target; hosted approval enforcement follows in the governance tickets.
