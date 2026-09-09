# External shared-package admission (DEN-3958)

This test-org consumer pins the real ORESoftware/ores-interfaces package and its
independent upstream TypeSpec/JSON Schema sources and TJSV compiler. It replays
the producer's full unit/integration checks under Node 24, including concealed
source/validator changes that Git reports clean, package invalidation and recovery.
It then packs via the real prepack gate, imports public package exports from a
separate consumer, and re-runs upstream TJSV admission on the exact unpacked bytes.
The independently asserted inventory is four public declarations and 31 recorded
cases. Artifact receipts contain source pins and the tested package SHA-256.

No TJSV implementation or production authority is copied into this test repository.
The existing historical rejection lifecycle, runtime wire-envelope, and real
TypeScript/Rust production conformance workflows remain untouched. Older blocked
source snapshots are not silently relabelled as today's accepted package.

Run the workflow with the source-pins.json checkouts at tmp/shared-hub and its
.deps/compat and .deps/tjsv paths. Missing dependencies fail; no skipped admission,
handwritten lock, release, registry-backed frozen installation or whole-fleet
runtime equivalence is claimed. Ignored temporary output is scoped to tmp/.
