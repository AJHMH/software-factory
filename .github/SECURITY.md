# Security policy

## Supported versions

Security fixes target the current default branch of this Software Factory template.
There are no supported versioned releases yet. Adopting workloads must maintain
their own supported-version and vulnerability-response policies.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** option in this repository's Security tab
when private vulnerability reporting is available. Keep credentials, exploit
details, and sensitive logs out of public issues and pull requests.

If private reporting is unavailable, open an issue requesting a private reporting
channel without describing the vulnerability or including sensitive evidence.
Maintainers must establish that channel before collecting the report. No response
or remediation deadline is guaranteed by this scaffold.

## Review sources

The Factory uses GitHub's security policy, Dependabot alerts, code scanning alerts,
and secret scanning alerts as its current code-quality and security review sources.
CodeRabbit review is not required or used for this project.

An absent alert is not evidence that a scanner ran or that a revision passed.
Required scans must be enabled, applicable, and current before their results can
authorize delivery. The template's readiness interface currently blocks required
unsupported gates. See [the security documentation](../docs/security.md) and
[capability inventory](../docs/capabilities.md) for current limitations.
