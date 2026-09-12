# External validation/interface certification

This test organization independently certifies immutable producer commits. It does not trust producer branch names or CI receipts by themselves.

For every cohort member it:

1. reruns the exact pinned `ORESoftware/api-docs` semantic parity tool;
2. compares the independently generated TypeSpec and JSON Schema signatures;
3. recomputes every committed target digest and the aggregate receipt digest;
4. rejects duplicate model scope assignments and public/edge/browser leakage of server-only types;
5. verifies stable `api-docs` operation IDs; and
6. compiles the committed TypeScript, Rust, Go, and Gleam interface outputs.

A producer update requires a new immutable commit in `cohort.v2.json`. A discrepancy is evidence to stop and evaluate; this repository never regenerates or overwrites producer definitions.
