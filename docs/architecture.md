# Architecture 

## System Design
The Universal Software Factory operates on a hub-and-spoke model. The "Factory" is the centralized platform (the hub) containing all policies, agent definitions, and CI/CD logic. Individual projects (the spokes) inherit these capabilities by implementing the `factory-contract.yaml`.

## Decision Records (ADRs)
- **ADR-001:** Use GitHub Actions as the primary orchestration engine.
- **ADR-002:** All policies must be written in declarative YAML to allow both human and machine parsing.
- **ADR-003:** AI Agents will be used for code review, remediation, and operational telemetry monitoring.
