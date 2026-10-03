# Software Factory: Governed Automation Foundation

## Problem Statement

The Software Factory template describes a reusable platform that builds, validates, releases, and operates workloads under shared governance. Its current implementation does not reliably enforce those guarantees: policies are usually printed rather than evaluated, several checks simulate success, and privileged automation can run without the required authorization or validation evidence.

As the factory owner, I need adopting repositories to receive working, verifiable controls before autonomous agents can modify code, merge changes, publish releases, or initiate recovery. I also need a clear distinction between implemented capabilities and future roadmap items.

Git initialization, the nested repository layout, and the initial ignore rules have already been addressed and are not implementation work for this specification.

## Solution

Deliver a phased Governed Automation foundation. Start with safe defaults and a single runnable reference workload. Implement contract validation, deterministic policy evaluation, enforced merge and release gates, and evidence collection. Then package these capabilities for reuse across workload repositories. Agent autonomy remains limited to demonstrably supported actions and expands only after boundary and failure tests pass.

An adopting repository should be able to declare its supported workload profile, run the same validation locally and in CI, understand every failed gate, and trace a released artifact to the exact source revision and validation evidence that authorized it.

## User Stories

1. As a factory owner, I want an inventory of implemented and unimplemented capabilities, so that I can assess readiness without relying on simulated success.
2. As a workload maintainer, I want actionable contract validation errors, so that I can correct onboarding problems before executing a pipeline.
3. As a workload maintainer, I want missing or empty required commands rejected, so that an absent command cannot satisfy a gate.
4. As a developer, I want compound validation commands to execute correctly, so that linting and type checking both run.
5. As a developer, I want a shared local and CI validation interface, so that I can reproduce failures before opening a pull request.
6. As a factory owner, I want a runnable reference workload, so that factory changes can be tested against a complete delivery lifecycle.
7. As a security owner, I want real secret and dependency scans, so that exposed credentials and vulnerable packages block delivery according to policy.
8. As a security owner, I want vulnerability findings evaluated separately from scanner execution failures, so that remediation responds to the actual finding.
9. As a reviewer, I want global and changed-code coverage requirements enforced, so that passing tests do not conceal insufficient coverage.
10. As a repository owner, I want critical paths and sensitive changes to require human approval, so that agents cannot approve their own exceptions.
11. As a repository owner, I want required checks evaluated against the current pull request revision, so that stale evidence cannot authorize merging.
12. As a maintainer, I want dependency updates classified and checked against exemptions, so that major or high-risk updates receive human review.
13. As a maintainer, I want scheduled dependency maintenance to perform useful work, so that its schedule does not merely produce skipped jobs.
14. As a repository owner, I want remediation callers authenticated and authorized, so that arbitrary issue comments cannot invoke privileged automation.
15. As a security owner, I want event inputs treated as data, so that branch names, identifiers, and payloads cannot become executable scripts.
16. As an agent operator, I want restricted paths and tools enforced outside agent prompts, so that policy boundaries remain effective when an agent misbehaves.
17. As a maintainer, I want proposed fixes committed to the correct source branch and revalidated, so that fixes do not rely on synthetic merge commits or assumed workflow triggers.
18. As a release owner, I want releases authorized by validation, security, and approval evidence for one revision, so that failed or unreviewed code cannot be certified.
19. As a release owner, I want real semantic versions, changelogs, and immutable artifact identifiers, so that published releases can be traced and reproduced.
20. As an operations owner, I want actual endpoint checks using configured thresholds, so that health reports describe deployed workloads.
21. As an operations owner, I want deduplicated incidents and recovery notifications, so that repeated failures remain actionable.
22. As an operations owner, I want rollback to restore a compatible deployed artifact, so that recovery does not require resetting the main branch.
23. As a governance owner, I want auditable policy exceptions with owners and expiry, so that temporary concessions do not silently become permanent defaults.
24. As a governance owner, I want repository protections checked for drift, so that hosted settings remain consistent with factory policy.
25. As an agent operator, I want retry, elapsed-time, and spending limits with a kill switch, so that autonomous work is bounded and interruptible.
26. As a factory owner, I want versioned reusable workflows and policy packs, so that improvements reach workload repositories without uncontrolled drift.
27. As a workload maintainer, I want documented supported runtime profiles, so that unsupported workloads fail clearly rather than receiving inappropriate defaults.
28. As an auditor, I want redacted delivery and agent evidence with access and retention controls, so that decisions can be inspected without exposing credentials.
29. As a new contributor, I want complete setup and operating instructions, so that I can adopt and maintain the factory without undocumented knowledge.

## Implementation Decisions

- Preserve the existing Knowledge, Governance, Validation, Release, and Observability Plane vocabulary and GitHub Actions orchestration architecture.
- Target Governed Automation first. Conditional Autonomy is a later capability gated on demonstrated enforcement, not a default readiness claim.
- Implement in four increments: safe defaults and execution repairs; a working reference delivery lifecycle; policy and hosted governance enforcement; reusable distribution and bounded agent execution.
- Disable unconditional dependency merging and privileged agent writes until their authorization, policy evaluation, and revision-specific validation are implemented.
- Unimplemented required capabilities fail certification. Optional capabilities report an explicit unsupported or skipped state with a reason; they never report simulated success.
- Introduce versioned schemas for the factory contract, policy packs, workload profiles, and overrides. Reject malformed required fields, unknown unsupported profiles, and invalid policy values.
- Define a public factory validation interface that accepts a workload contract and approved policy context, returns machine-readable gate results, and exits unsuccessfully when mandatory gates fail.
- Package parser and validator dependencies explicitly rather than depending on incidental runner installations. Define command execution semantics, working directory, timeouts, and exit-code propagation.
- Begin with one supported reference workload profile. Additional profiles must supply runtime setup, validation, scanner, artifact, and operations adapters with documented compatibility.
- Evaluate authoritative policies from a trusted revision. Proposed policy changes and overrides require governance approval before they can weaken enforcement for their own pull request.
- Define policy precedence and exceptions explicitly. Exceptions include scope, reason, owner, approver, expiry, and recorded evidence.
- Verify current revision, required checks, human approval identity, update classification, sensitive paths, and vulnerability thresholds before authorizing merges. Respect hosted rulesets and avoid broad bypass privileges.
- Separate read-only validation jobs from privileged dispatch, merge, and release jobs. Use narrowly scoped identities and permissions for each action.
- Authenticate remediation requests, validate input types and lengths, and pass external values through data interfaces rather than interpolation into shell or JavaScript source.
- Agent instructions guide behavior; independent controls enforce path restrictions, tool permissions, budgets, retry limits, and cancellation. Repository and issue content are untrusted context.
- Handle source branches and forks explicitly. Revalidation after bot changes is designed and tested with the selected GitHub identity and approval model.
- Certify releases for the exact validated source revision. Bind approvals and evidence to that revision and publish artifact digests, version metadata, and changelogs.
- Add supply-chain scanning and SBOM evidence before claiming supply-chain policy enforcement. Add artifact signing and provenance as part of release certification capabilities.
- Monitor actual deployed workload health. Keep incident creation idempotent and record recovery. Deployment rollback restores an existing compatible artifact; source correction is a separate reviewed change.
- Document migration compatibility and escalation before enabling automatic rollback. Unsupported rollback remains a human operation.
- Add governance bootstrap and drift checks for hosted repository settings. Document settings and capabilities that require organization administration or a particular GitHub entitlement.
- Distribute the factory through versioned reusable workflows and policy packs with documented upgrades, compatibility, and rollout controls.
- Replace placeholder operating documentation with onboarding, architecture decisions, testing, deployment, ownership, incident, and exception procedures. Distinguish configured controls from demonstrated compliance evidence.

## Testing Decisions

- Confirmed testing approach: use the public factory validation interface as the principal test seam, with GitHub integration checks for hosted behavior that cannot be proven locally.
- Test observable outcomes: gate results, exit codes, emitted evidence, denied actions, created proposals, and published artifacts. Avoid assertions about internal helper structure or agent wording.
- There is no existing executable test suite or established test fixture pattern in the reviewed template. Introduce one reference workload and contract/policy fixtures as shared test inputs.
- Exercise malformed contracts, missing and empty commands, compound commands, command failures, timeouts, unsupported runtimes, and incorrect policy types through the validation interface.
- Prove that failed tests, inadequate coverage, leaked fixture secrets, disallowed vulnerabilities, missing approvals, expired exceptions, and restricted-path changes cannot authorize delivery.
- Verify that a pull request cannot weaken its own authoritative policy context or reuse evidence from an earlier revision.
- Use a dedicated integration repository for dependency classification, repository rules, fork behavior, token permissions, bot revalidation, required reviews, and release ordering.
- Verify that unauthorized remediation comments are rejected and hostile input is processed as data without executing embedded commands.
- Verify retries and duplicate events do not create uncontrolled loops, duplicate incidents, multiple releases, or repeated charges beyond configured limits.
- Exercise healthy, failing, timed-out, and recovered endpoint scenarios. Verify rollback changes the deployed artifact and preserves source history; verify incompatible migrations require escalation.
- Require every implemented capability to supply evidence of both successful operation and denial when its governing requirement is unmet.

## Out of Scope

- Implementing an application-specific product feature.
- Repeating Git initialization, repository flattening, or initial ignore-file creation.
- Supporting every programming language and hosting platform in the first increment.
- Unrestricted autonomous merging, production changes, or a Dark Factory maturity claim.
- Claiming SOC 2 compliance from a configuration flag or this specification alone.
- Selecting an agent vendor, cloud provider, or paid observability product without a separate implementation decision.

## Further Notes

- This specification synthesizes the repository review and subsequent corrections. The review recommendations are proposed implementation requirements, not claims that the corresponding controls already exist.
- The factory owner selected GitHub Issues in aaron-howard/software-factory as the issue tracker and approved the default triage vocabulary. Publish this specification with the ready-for-agent label.
- The factory owner confirmed the testing approach required by the invoked skill.
