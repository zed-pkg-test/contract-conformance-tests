import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace OresLambdaCallableRegistry;

@pattern("^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)+$")
scalar CallableName extends string;

@pattern("^[a-z0-9_]+_a[0-9]+_[0-9a-f]{20}$")
scalar CallableId extends string;

@pattern("^src/(routes/rest/.+/handlers|rpc/.+/funcs|graphql/.+/resolver)\\.rs$")
scalar AuthoritySource extends string;

@pattern("^src/(routes/rest|rpc|graphql)/.+/lambda\\.rs$")
scalar LambdaSource extends string;

@pattern("^(rest_leaf:src/routes/rest/|rpc_leaf:src/rpc/|graphql_leaf:src/graphql/).+$")
scalar LeafIdentity extends string;

enum CallableOriginKind {
  rest_leaf,
  rpc_leaf,
  graphql_leaf,
}

enum TransportLeafKind {
  rest,
  rpc,
  graphql,
}

enum TransportLeafStreamMode {
  unary,
  server_stream,
}

enum GraphqlLeafKind {
  query,
  mutation,
  subscription,
}

@id("LambdaCallableIdentityV1")
model LambdaCallableIdentityV1 {
  schema_version: "ores.lambda.callable-id.v1";
  callable_name: CallableName;
  arity: uint16;
  callable_id: CallableId;
}

@id("TransportLeafBuildIdentityV1")
model TransportLeafBuildIdentityV1 {
  schema: "ores.api-docs.transport-leaf-build-identity.v1";
  abi_version: "ores.api-docs.transport-leaf-abi.v1";
  transport: TransportLeafKind;
  operation_key: CallableName;
  callable_id: CallableId;
  @minLength(1)
  projection_id: string;
  stream_mode: TransportLeafStreamMode;
  graphql_kind?: GraphqlLeafKind;
  capabilities?: Record<string>;
}

@id("CallableProjectionLocatorV1")
model CallableProjectionLocatorV1 {
  @doc("Authored semantic leaf family. This is source provenance, not the public transport. REST leaves may project through both REST and generated RPC.")
  origin_kind: CallableOriginKind;
  @doc("Current physical leaf locator. It may change on a source move and is never browser/client identity.")
  leaf_identity: LeafIdentity;
  authority_source: AuthoritySource;
  lambda_source: LambdaSource;
  transport_identity: TransportLeafBuildIdentityV1;
}

@id("CallableRegistryEntryV1")
model CallableRegistryEntryV1 {
  callable: LambdaCallableIdentityV1;
  @minItems(1)
  projections: CallableProjectionLocatorV1[];
}

@id("LambdaCallableRegistryV1")
model LambdaCallableRegistryV1 {
  schema_version: "ores.lambda.callable-registry.v1";
  generated_by: "ores-stack";
  entries: CallableRegistryEntryV1[];
}

// Cross-field rules are independently enforced in Rust rather than approximated
// through generated schema logic:
// - callable_id is recomputed only from callable_name + arity;
// - transport_identity operation_key/callable_id must match the parent callable;
// - rest_leaf may project through rest or rpc; rpc_leaf only through rpc;
//   graphql_leaf only through graphql;
// - authority_source/lambda_source must be siblings in the canonical origin root;
// - callable ids/names are unique registry-wide; a physical lambda_source may
//   intentionally carry multiple callables/projections and path lookup is one-to-many;
// - duplicate projections for one callable are rejected;
// - query/mutation are unary; subscription is server_stream.
