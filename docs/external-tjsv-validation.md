# External TJSV admission tests — DEN-3958

This test organization executes the actual pinned TJSV compiler/validator against
`ORESoftware/ores-interfaces` PR #2 at 7e76519750e53042ff3b5862d21b69a59bcf3d83.
The validator is pinned at 4473504c4c9d2831d825919f70c03994d8ce01d2 and installs
its committed toolchain lock. No validator implementation or source authority is
copied into this test repo. No production secrets or deployments are involved.

The shared-interface candidate currently has eight structural admission findings.
Two repeated real runs must remain STOPPED_FOR_EVALUATION, produce the same run ID,
leave source bytes unchanged and replace any stale positive-looking Contract IR
with non-admissible evidence containing no approved declarations. Passing this
regression test means rejection worked; it does NOT approve those contracts.

A separate pair of independently written synthetic test authorities exercises a
complete state sequence: positive admission, one-lane semantic drift, restoration,
TypeSpec compiler failure, and restoration again. Positive runs must produce actual
admissible IR. Drift and compiler failure must invalidate that previous approval;
recovery must restore the original deterministic run ID. Exact exit codes, reports,
IR files and compiler output are checked and retained for all seven invocations.
The test pair is not generated from either compiler output or production sources.

Existing Zed production conformance and repository tests remain untouched. These
are compiler/admission lifecycle tests, not registry publication, resolver/frozen
installation evidence, whole-fleet Zod/Serde certification or browser UI testing.
Shared-interface structural findings and dependency advisory triage remain their
own release gates. Do not turn this suite's successful rejection tests into a
passing contract approval receipt.
