# ADR 008: Consumer certification evidence and hosted identities

Status: Accepted for implementation; hosted success remains tracked in #49.

Factory source, consumer merge revision, reviewed PR head and source baseline are
independent identities. Distribution 1.0.1 produces all baseline gates with Factory
policy read from its immutable executing checkout. Workload execution receives no
certification credential. Read-only review/SAST collectors operate separately.

GitHub prefixes reusable checks with their caller job. The immutable adoption
contract already requires that job to be `validation`; governance and certification
therefore require every baseline check under `validation / `. All Actions identity,
strictness, review and protection requirements remain intact. This mapping does not
permit arbitrary caller-selected names or drop a baseline gate.

A trusted CodeQL profile allowlists native and advanced analysis identities. The
consumer's isolated workload uses a separate full-workload CodeQL scan and exact
head SHA/ref, preserving the existing application scan and its findings. Selecting
an unapproved analysis identity fails closed.

Execution-policy producers now include an evidence digest. The public
`consumer-evidence` operation assembles six reports without manufacturing results
or implying live certification. Merged review collection explicitly binds the
original approved head/base to the exact source merge commit and rechecks live
reviews. Certification still verifies live required checks, review, governance,
defect limits and immutable artifact/SBOM bytes before writing a certificate.

Operators authorize additive protections and minimum read credentials separately.
The proposal App retains its PR-only role. Publication/deployment and certification
of the surrounding application are outside this decision.
