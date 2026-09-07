# Cross-repository Contract IR admission canary

Tracking: DEN-3828, DEN-3600, ORESoftware/typespec-json-schema-validator#20;
production implementation: zed-pkg/zed-clients#64.

This suite imports the actual Zed guard at the immutable client revision in
`fixtures/contract-ir-pins.json`. It does not copy the implementation into the
test organization. The validator/official compiler is separately pinned; the
suite asserts both checked-out commits and the guard's required validator pin.
The pin intentionally certifies the PR implementation, not a released SDK.

Two independent local test authorities model `PackageInstallIntent`. The CLI
compiles TypeSpec, compares its witness to authored JSON Schema, runs probes,
and emits the receipt and Contract IR before the consumer can attempt admission.
The sibling suite checks positive admission, forbidden exports, missing required
declarations, transitive TypeSpec source drift, rehashed disabled evidence, and
a real probes-disabled run replacing the prior passing artifact with a tombstone.

Run after provisioning the pinned dependencies as in the workflow:

```sh
node --test tests/contract-ir-consumer.test.mjs
```

Missing compiler or dependency checkouts fail; there is no offline-success or
skip mode. Temporary fixture copies live under the disposable validator checkout
so TypeSpec resolves its pinned libraries. No production authority is rewritten.
The existing `deep-tests.yml` deterministic suite remains unchanged and must
also pass on this PR. These canaries certify this admission boundary, not the
complete registry API, every target-language SDK, or production publication.
