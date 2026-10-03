# Security & Threat Model

## Threat Vectors
1. **Supply Chain Attacks:** Mitigated via strict Dependency policies (e.g., auto-updates, SCA scans).
2. **Credential Leaks:** Mitigated via mandatory pre-commit and CI secret scanning.
3. **Malicious Code:** Mitigated by the AI Review Agent and SAST scans.

## Compliance
- All workloads default to SOC2 compliance mode unless overridden in `governance.yaml`.
- Audit logs of all agent actions and prompts are retained for 365 days.
- Critical paths (e.g., `src/auth`) mandate multi-party human review.
