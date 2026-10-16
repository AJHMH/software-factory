# Developer OS alongside profile-page

The Factory accepts separate consumer repositories through independently pinned
reusable workflows. Adding `AJHMH/developer-os` does not replace
`AJHMH/profile-page` or change its approved Factory revision. Profile-page retains
its isolated `node-24` workload; Developer OS selects `node-24-typescript-cli` for
its actual application. Each consumer has its own source history, reviewed PR,
approved revision, credentials, check runs, protections and certificate.

## Supported CLI scope

Distribution 1.1.0 adds `typescript-cli-npm-v1`. The supported application is the
ESM `aios` CLI compiled from all ordinary `src/**/*.ts` files to `dist/` with
NodeNext, source maps and declarations. It requires a pinned TypeScript compiler,
a matching npm lockfile v3 and no runtime dependencies or workspaces. Root `.`
workloads are supported for this profile. Other entry points, assets, compiler
layouts, runtimes and application frameworks remain unsupported.

The artifact is a canonical, bounded `cli-bundle.json` containing the committed
package manifest and every expected JavaScript, source-map and declaration file.
Packaging rejects unexpected files and links. Source evidence binds all TypeScript
sources and compiler configuration. Verification checks the retained bytes,
inventory, source maps, validation report, source revision and SPDX SBOM without
extracting, executing or rebuilding the application. Compilation is established
by the exact-source producer's validation; verification does not independently
recompile or prove semantic equivalence. The reference publication/promotion and
rollback adapters do not accept CLI bundles.

## Repository onboarding

1. Merge the Factory profile proposal after current owner GitHub review and all
   required checks. Use its actual merge SHA as the consumer lock and both workflow
   pins; never substitute a mutable branch or assume the proposal SHA is approved.
2. Prepare an App-authored consumer PR with the lock, root contract, native CI and
   full-repository JavaScript/TypeScript and Actions CodeQL. Formatting-only
   baseline repair is separately owner-authorized. Preserve existing application
   behavior and every genuine test.
3. The operator independently selects the reviewed Factory SHA through
   `FACTORY_DISTRIBUTION_REVISION`. This setup is scoped to Developer OS only.
4. Provision the eight `validation / ...` Factory checks listed in
   [consumer certification](consumer-certification.md), plus native
   `Validate Developer OS CLI` and both CodeQL checks. After their producers are
   present, explicitly authorize additive, no-bypass default-branch protection,
   one current owner review, stale-review dismissal, resolved threads, signatures,
   linear history, deletion prevention and force-push prevention. Inspect live
   protections through `bootstrap-governance` without `--apply true` and retain its report.
5. Configure an expiring consumer-only `FACTORY_CERTIFICATION_READ_TOKEN` directly
   in GitHub with Administration, Checks, Issues and Pull requests read. Do not
   copy a broad saved CLI credential into a hosted secret or expose it to workload
   steps. The App PEM stays outside both repositories and GitHub.
6. Obtain `aaron-howard`'s actual GitHub approval on the final App PR head. Rerun
   original review gates after approval when necessary, verify every check and
   current approval, then conditionally merge. Obtain the exact-source main push
   producer and assemble its six passing reports through `consumer-evidence`.
7. Dispatch certification against that producer, merged PR and unchanged evidence
   bundle. Retain the successful hosted certificate, bundle/SBOM digests and run
   URLs before calling Developer OS certified. Failed or missing gates remain
   blockers; onboarding configuration alone is not certification.

CLI coverage installs the lock without lifecycle scripts, compiles both committed
head and baseline snapshots, and measures all TypeScript sources with c8 source-map
remapping. `tests/delivery.test.mjs` supplies the public CLI integration suite;
other top-level test files supply the unit/control suites. The same 80% global,
90% new-code and no-decrease requirements remain in force. Coverage or scanner
findings may require a separately scoped repair before onboarding completes.

## Feature delivery

App-authored, signed proposals and owner-reviewed merges are repository-scoped
operations. Verify the App installation can access Developer OS and the same
signed commit is valid locally and verified by GitHub. The owner is the sole
human approver; agents never submit an approval. Keep an external owner policy
per repository; candidate files cannot grant delivery authority or change the
trusted Factory pin. Use the Developer OS controller's canonical repository
identity and per-repository ownership rather than a global current/last repo.

The Developer OS controller already models independent repositories and queues
requests for the same canonical repository. Its production worker, authentication
mediation, live onboarding inspection and remote delivery gates are still subject
to its own implementation/qualification tickets. CI onboarding does not enable
unqualified autonomous worker execution. Until those gates are implemented and
qualified, use the governed human-reviewed proposal process and retain the
controller's explicit delivery blocker.

## Observed setup, 2026-10-10

`AJHMH/developer-os` exists on `main`. The dedicated Factory App installation
authenticated successfully with Contents read and Pull requests write for this
repository. At inspection it had no workflow directory, active rulesets, classic
branch protection or Actions variables. On unchanged main, typecheck and all 65
tests passed outside the Windows filesystem sandbox; formatting failed on 29
files and the owner authorized formatting cleanup. These observations do not
establish live signing, hosted CI, governance compliance or certification.

## Coverage diagnostics and approval evidence reuse

`measure-coverage` records each executed install, build, separate test and
instrumentation stage in its JSON report under `diagnostics.stages`. Each record
includes start/end times, duration, exit code, signal, deadline and process-tree
termination status, and output truncation. Failed stages also retain bounded
stdout/stderr (at most 65,536 characters each). Known secret-bearing environment
values and GitHub token patterns are redacted; do not deliberately print secrets
from workload tests. Successful stage output is omitted. Diagnostics explain
execution; they never supply approval or alter policy evaluation.

The collector report is retained in the existing gate artifact even when the
command fails. Coverage evidence keeps its existing strict schema and revision
bindings. The collector still performs every existing required suite and
instrumented measurement under the same command budgets.

The reusable consumer workflow produces source coverage once. When source and
reviewed head match, a reviewed-head preparation job downloads that exact
same-run immutable artifact ID and re-evaluates it. On main pushes, the merge
revision and reviewed PR head can differ; the latter is measured separately
once for both approval jobs. Neither approval job reruns workload tests.

Both approval jobs retain their required names, read-only review permissions,
immutable Factory adoption inspection, and independent current-owner review
evaluation. They fail explicitly if their evidence producer failed, was skipped,
or supplied no exact artifact ID. Local evidence is revalidated for head, base,
contract, source and current trusted policy. No evidence from another workflow
run, arbitrary artifact name, or prior review is substituted. Approval refresh
reruns those same checks and consumes their original producer output.

This removes two repeated collections on PRs and one on main pushes; it does not
remove the first collection's cost or diagnose the intermittent failure itself.
Use failed-stage diagnostics to identify that cause before changing scheduling.
