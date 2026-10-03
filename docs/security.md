# Security & Threat Model

## Implementation status
The controls below are target requirements, not implemented guarantees. Security
gates currently report unsupported and block certification; no secret, dependency,
or SAST scan is performed by the scaffold. See [capabilities](capabilities.md).

## Threat Vectors
1. **Supply Chain Attacks:** Mitigated via strict Dependency policies (e.g., auto-updates, SCA scans).
2. **Credential Leaks:** Mitigated via mandatory pre-commit and CI secret scanning.
3. **Malicious Code:** Mitigated by the AI Review Agent and SAST scans.

## Governance targets
- The SOC2 policy flag is a configuration intention, not evidence of compliance.
- Audit retention of 365 days is a target; an audit store and retention enforcement are not implemented.
- Critical-path multi-party human review is a target; hosted approval enforcement follows in the governance tickets.
