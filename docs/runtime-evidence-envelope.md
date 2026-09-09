# Runtime evidence wire-contract regression

Tracking: DEN-3828 and ORESoftware/typespec-json-schema-validator#57.

This sibling test repository exercises the real TJSV normalizer and the
published runtime-evidence JSON Schema through separate validation paths.
The implementation is imported from the immutable upstream commit
`afbbaea124bcf9b0831b97153c5896c269848a44`, never copied into this repository.

The 37 consumer-owned tests serialize fixtures to JSON and back, then require
both schema validation and runtime admission to match independently specified
expectations. They cover an exact positive envelope; array, nested-array,
object, numeric and null digests; every required field at all three envelope
levels; and undeclared stdout/prototype-shaped properties. Invalid envelopes
must produce blocking findings, and unknown payload values must not survive
in normalized output or those findings.

These fixtures test evidence-format admission, not native Rust execution or
proof of application-level validation. The existing production workflow still
checks actual TypeScript and Rust validators separately, with its existing
source pins and tests unchanged. TypeSpec and JSON Schema remain independent
authored authorities; this test does not replace either lane.

The new workflow verifies the exact consumer and TJSV revisions, refuses to run
outside a `*-test` owner, retains TAP/revision evidence, and checks both tracked
trees remain unchanged. Dependency or execution failures fail the job. All
existing test workflows remain independent gates; no production code, package
release, deployment, credential, or protection setting is modified here.
