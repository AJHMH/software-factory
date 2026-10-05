# Factory Validation capabilities

Use `node scripts/factory-validation.mjs inventory` for current implemented capabilities. `capability <name> --required` reports an available but unexecuted gate as `not-run` and exits nonzero. `certify` without required evidence fails closed. Availability never establishes passing validation, hosted approval or permission to mutate GitHub.

| Operations | Implemented scope / procedure |
| --- | --- |
| `validate`, `profile`, `distribution` | [Contract execution](contract-execution.md) and [versioned consumers](factory-distribution.md) |
| `policy`, `coverage`, `measure-coverage` | [Trusted policy](policy-evaluation.md) and [coverage](coverage-enforcement.md) |
| `security`, `scan-security`, `sast`, `collect-sast` | [Secrets/dependencies](security-enforcement.md) and [CodeQL](sast-enforcement.md) |
| `human-review`, `collect-reviews`, `governance`, `collect-governance`, `bootstrap-governance` | [Review](human-review.md) and [governance](repository-governance.md) |
| `propose-change`, `prune-agent-evidence`, `remediate`, `local-remediate` | [Bounded proposals](bounded-agent-proposals.md), [remediation](authorized-remediation.md) and [local publication](local-remediation.md) |
| `dependencies` | Governed update/evaluate/merge operations and [dependency policy](../policies/dependencies.yaml) |
| `certify`, `release` | [Certification](release-certification.md) and [signed publication](versioned-releases.md); CLI release prepares only |
| `promote`, `rollback`, `health-monitoring` | [Promotion](artifact-promotion.md), [package restoration](runbooks/deployment-rollback.md) and [monitoring](operations.md) |
| `readiness --mode inspect\|demonstrate` | [Controlled demonstration and dated readiness gaps](governed-automation-readiness.md) |

Mutating operations require documented authorization and exact evidence. Metadata cannot authorize them. Agent adapters are controlled fixtures; unrestricted tools and real provider billing are unsupported. Promotion/rollback use the filesystem reference package adapter. Runtime recovery is unsupported. The readiness report distinguishes implementation, local proof and live evidence.
