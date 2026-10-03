# Versioned Factory contract execution

## Supported profile and schema

Contract version is the quoted string `"1.0"`, validated against the committed JSON
Schema. The only supported profile is `node-24`, selecting Node.js 24.x. Unknown
versions, profiles, fields, missing commands, whitespace commands, and invalid
timeout values fail before any workload command executes.

The contract declares workload_id, profile, working_directory, and exactly four
commands: install, validate, test, build. Each command supplies run and an integer
timeout_seconds between 1 and 600. Working directories are relative to the contract
directory; absolute paths and paths escaping it, including symlink targets, are
rejected. A Git repository with a committed revision is required.

This replaces the illustrative contract's string commands and deployment fields.
Health, deployment, release, policies, and exceptions are not supported by this
execution schema. Additional runtime profiles require explicit implementation.

## Public interface

Install locked Factory parser/validator dependencies with `npm ci --ignore-scripts`.

- `node scripts/factory-validation.mjs profile [--contract <path>]` validates without
  execution and returns runtime metadata. In GitHub Actions it writes the selected
  node_version to the step-output file.
- `node scripts/factory-validation.mjs validate [--contract <path>]` validates,
  verifies the active Node major version, and executes all four gates.
- Without an explicit path, use the current directory's factory-contract.yaml.

CI installs Factory tools, inspects the contract, selects Node from profile output,
and invokes the same validate command. Tooling bootstrap uses Node 24; workload
runtime selection is distinct from the bootstrap.

## Execution and timeout behavior

Commands run sequentially in the declared directory. Nonzero status, launch failure,
or timeout blocks the workload and prevents later gates from executing. Shells are
noninteractive Bash with pipefail on POSIX, and cmd.exe on Windows. Compound commands
such as `npm run lint && npm run typecheck` follow host shell quoting and semantics.
Prefer package scripts for portability. Commands execute intentionally: use trusted
local contracts and review contract changes as executable code.

Timeouts terminate the owned process group on POSIX or process tree via taskkill on
Windows. Windows requires permission to terminate owned processes. Failed cleanup
reports terminationFailed, remains failed, and requires operator cleanup; later
gates do not execute. Windows cleanup may add up to five seconds. Commands must not
daemonize or intentionally escape their process group.

Child commands do not inherit GitHub output/summary-file variables. Other environment
variables are inherited. Do not print secrets: captured stdout/stderr are retained
in reports, capped at 65,536 characters per stream with a truncation flag.

## Evidence and outcomes

JSON includes schema version, operation, outcome, workload identifier, profile, Git
revision, working-tree dirty flag, contract SHA-256 digest, working directory, and
per-gate status, exit code, signal, timestamps, timeout/termination flags, and output.
Invalid contracts return actionable failed contract results without execution.
Passing runs exit 0; blocked runs exit 1; invalid CLI arguments exit 2.

Revision identifies the checkout at execution start. Dirty local checkouts are
allowed and marked; these are not certified results for committed source. The digest
identifies actual contract content. Ignored/generated files do not affect Git's
dirty flag. Immutable release evidence and trusted policies remain future gates.

Inventory marks contract execution available. Capability metadata is not a passing
gate: required metadata reports not-run and certify remains blocked without actual
execution/security/policy/release evidence. Workload success does not pass unsupported
coverage, security, or approval requirements.

## Reference workload and verification

The small JavaScript library includes input-validation tests, syntax checks,
JavaScript typechecking, locked dependencies, and a build copying checked source to
an ignored dist directory. It also runs independently via package scripts on Node 24.

Public-interface tests cover execution, malformed schemas, unsupported profiles,
directory escape, compound failures, timeout cleanup, and runtime output. Workflow
fixtures verify CLI wiring and read-only permissions. Hosted GitHub execution is
the final cross-platform verification after this implementation is pushed.
