#!/usr/bin/env bash
set -euo pipefail

E2E='evidence/ores-pr-batch-20260930/ores-e2e-core-5.json'
DESKTOP='evidence/ores-pr-batch-20260930/ores-common-desktop-infra-68.json'

actual_e2e="$(git hash-object "$E2E")"
test "$actual_e2e" = '4ce41b901c2b43c206139c2ab3373e471191c3f9'
actual_desktop="$(git hash-object "$DESKTOP")"
test "$actual_desktop" = '3df8540573e2dc865a7bb8a45990675820f907d6'

jq -e . "$E2E" >/dev/null
jq -e '.schema == "ores.e2e.binary-payload-matrix/v1" and .transports == ["http","tcp","websocket"] and .codecs == ["json","messagepack","cbor","protobuf","raw"] and .invariants.framing_is_not_codec == true and .invariants.raw_and_protobuf_preserve_bytes == true and .invariants.semantic_validation_after_decode == true' "$E2E" >/dev/null

jq -e . "$DESKTOP" >/dev/null
jq -e '.schema == "ores.desktop-runtime-generation-case/v1" and .linear == "DEN-3045" and .product_id == "pony-expres" and .expected.reuse_model == "tenant_generation_cell" and .expected.reuse_key == ["tenant_id","deployment_generation"] and .expected.runtime_host_reuse_allowed == true and .fallback_policy.digest_fenced_regular_binary_reuse == true and .fallback_policy.unverifiable_path_or_name_only_reuse == false' "$DESKTOP" >/dev/null

echo 'exact source fixture certification passed'
