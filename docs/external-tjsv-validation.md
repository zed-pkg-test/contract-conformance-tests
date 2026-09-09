# External TJSV admission tests — DEN-3958

This test organization executes the actual pinned TJSV compiler/validator against
`ORESoftware/ores-interfaces` PR #2 at 7e76519750e53042ff3b5862d21b69a59bcf3d83.
The validator is pinned at 4473504c4c9d2831d825919f70c03994d8ce01d2 and installs
its committed toolchain lock. No validator implementation or source authority is
copied into this test repo. No production secrets or deployments are involved.

The shared-interface candidate currently has eight structural admission findings.
Two repeated real runs must remain STOPPED_FOR_EVALUATION, produce the same run ID,
leave source bytes unchanged and emit non-admissible evidence containing no
approved declarations. Passing this rejection test does NOT approve the contracts.

A separate pair of independently written synthetic test authorities exercises a
complete state sequence: positive admission, one-lane semantic drift, restoration,
TypeSpec compiler failure, and restoration again. Positive runs must produce actual
admissible IR. Drift and compiler failure must invalidate that previous approval;
recovery must restore the original deterministic run ID. These are genuinely
validator-owned artifacts, not hand-written positive-looking JSON placeholders.
The test pair is not generated from either compiler output or production sources.

An unowned caller file at the requested Contract IR path is a different boundary:
the validator must refuse to overwrite it, exit 3, preserve its bytes and report
failure. It is never accepted as a validator receipt. The evidence file named
`unowned-refusal.destination.json` is caller-owned test data, NOT Contract IR.

The first CI run exposed an incorrect test assumption that an arbitrary JSON file
should be overwritten. The validator correctly refused. The actual positive-to-
drift/failure/recovery sequence passed already; this correction adds a separate
non-clobbering test rather than weakening the stale-approved-IR checks. Exact exit
codes, reports, IR and compiler output are retained for all eight invocations.

Existing Zed production conformance and repository tests remain untouched. These
are compiler/admission lifecycle tests, not registry publication, resolver/frozen
installation evidence, whole-fleet Zod/Serde certification or browser UI testing.
Shared-interface structural findings and dependency advisory triage remain their
own release gates. Do not turn successful rejection tests into contract approval.
