# Contract command resource diagnostics

Each actual contract command retains `resourceDiagnostics` beside its original
status, timing and termination evidence. This applies to required consumer
validation through the shared executor; it does not substitute a separate probe
for the workload that failed.

The supervisor samples its own numeric resource usage at command start, every
two seconds and at completion. On Linux it also reads fixed aggregate CPU ticks,
CPU/I/O/memory pressure and cgroup CPU counters. These are host observations,
not per-test attribution. Unsupported Linux counters are explicitly null; other
platforms retain supervisor counters without Linux fields. At most 128 samples
are held in memory. Reaching that limit is explicit and stops periodic sampling.

The evidence contains no command arguments, environment values, authentication
or file contents. It is serialized with the existing command report only after
command reconciliation. Sampling exceptions stop further sampling and set
`samplingFailed`; they do not alter the command's exit status or authorize a
passing gate. Timers are unreferenced and cleared when the command finishes.
Diagnostic output-write failures cannot interrupt a still-running child because
no diagnostic file is written during command execution.

The command sequence, original deadlines, process-tree termination, concurrency,
coverage thresholds and human review requirements are unchanged. The additional
reads have a small measurement cost, so observations must be interpreted as
instrumented evidence. Missing or failed sampling is not evidence of healthy
resources. Aggregate host pressure cannot establish which individual test or
process caused a historical slowdown.

Developer OS PR #52 retains two historical Linux test timeouts at the existing
120-second limit. Seven separate diagnostic hosts passed; none supplied a trace
of an actual failed required run. These diagnostics enable that missing capture
on a future failure. They do not diagnose or repair those historical timeouts.

## Initial validation receipt

Node 24.21.0: all 11 focused diagnostics/contract tests and type checking passed.
Both independent review axes found zero actionable findings. Existing test files
are unchanged. The new tests failed before implementation when resource evidence
was absent, then passed after the executor change.

Complete local suite validation is incomplete. An unrelated rollback assertion
fails identically in an untouched `dda7ff9` snapshot: expected `escalated`, got
`restored`. Two full invocations were stopped after synthetic tag fixtures opened
interactive editors from the operator's signed-tag configuration. The second
excluded global Git configuration at the outer process, but readiness correctly
removed that override at its sanitized subprocess boundary. Neither incomplete
invocation is reported as passing; both logs and the unchanged-main differential
are retained privately. No personal/repository Git configuration or readiness
filter was changed. Hosted exact-head validation remains required.

The owner authorized this separate shared-Factory diagnostic scope and 30 extra
active investigation minutes on 16 October 2026. Conservatively charge 20 active
minutes for this initial capture implementation and validation; five previous
minutes plus the extension leave 15 active minutes. CI and approval waits are
excluded. This diagnostic implementation is not a cause-specific runtime repair
or another retry of unchanged failed Developer OS main.
