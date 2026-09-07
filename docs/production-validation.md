# Production public validation: external-consumer certification

Related merged PRs: zed-pkg/zed-interfaces#90 and zed-pkg/zed-lib-core#41.
Tracking: DEN-3828 / DEN-3600; upstream typespec-json-schema-validator#20.

Unlike the generic Contract IR canary, this suite imports actual production
RequestMeta, PageQuery and ProblemDetails implementations. It checks all three
immutable dependency revisions, runs the real peer-authority compiler admission
step, and independently exercises 111 boundary probes against BOTH retained
schema lanes and the real TypeScript runtime. It requires accepted values to
round-trip unchanged. There is no copied validation implementation or editable
third schema authority in this test repository.

Probes cover each field's omission, null and wrong-type behavior; requiredness;
ASCII and astral-Unicode length boundaries; integer/fraction limits; and unknown
fields including an own __proto__ key. New model/property kinds or a changed
coverage count stop the suite for review rather than silently reducing scope.
The aggregate union and the 34 recorded public cases are certified by the real
production compiler gate invoked before these extra probes.

The sibling job also executes the actual pinned Rust library's eight ordinary
wire tests plus its 34-case production corpus runner and additional Unicode /
integer spelling cases, with formatting, Clippy and the original root Cargo lock.
Those Rust cases are production-owned, while the 111 extra TypeScript probes are
independently owned here; neither is represented as universal equivalence evidence.

All installs use committed locks. Missing compiler/dependency checkouts fail.
The existing generic IR admission and Deep test suite workflows remain required
and unchanged. The dependency manifest pins the tested lib-core merge
`bf67d6ea1cdbb90617e556ba35afefb2fcfe36a9` and the tested interfaces merge
`58495c9aaf438b043a5e8bc154d27e9409eabc2d`, not mutable branch names.
Private server-schema compilation, other SDK runtime lanes, consumer deployment,
and signed release admission are outside this scoped certification.
