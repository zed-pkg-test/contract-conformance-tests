import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace OresLambdaBuild;

@pattern("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
scalar RepositoryIdentity extends string;

@pattern("^[0-9a-f]{40}$")
scalar GitSha extends string;

@pattern("^[0-9a-f]{64}$")
scalar Sha256Hex extends string;

@pattern("^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)+$")
scalar OperationKey extends string;

@pattern("^[A-Z][A-Z-]*$")
scalar HttpMethod extends string;

@pattern("^/")
scalar AbsolutePath extends string;

enum LambdaBuildProvider {
  aws,
  gcp,
}

enum LambdaFunctionKind {
  web,
  api,
}

enum LambdaCarrier {
  http_ingress,
  direct_invoke,
}

enum LambdaServerRole {
  web_server,
  admin_web_server,
  api_server,
  admin_api_server,
}

@id("LambdaSourceIdentityV2")
model LambdaSourceIdentityV2 {
  repository: RepositoryIdentity;
  commit_sha: GitSha;
  @pattern("^src/(pages|routes)/(.+/)?lambda\\.rs$")
  lambda_source: string;
  @doc("SHA-256 of the exact generated lambda.rs bytes admitted into this physical build unit.")
  lambda_source_sha256: Sha256Hex;
  role: LambdaServerRole;
}

@id("LambdaHttpProjectionV2")
model LambdaHttpProjectionV2 {
  method: HttpMethod;
  path: AbsolutePath;
  operation_key: OperationKey;
}

@id("LambdaFunctionBuildUnitV2")
@extension(
  "allOf",
  #[
    #{
      `if`: #{
        properties: #{ kind: #{ `const`: "web" } },
        required: #["kind"],
      },
      `then`: #{
        required: #["page_route"],
        properties: #{
          carrier: #{ `const`: "http_ingress" },
          source: #{
            properties: #{
              lambda_source: #{ pattern: "^src/pages/(.+/)?lambda\\.rs$" },
              role: #{ `enum`: #["web_server", "admin_web_server"] },
            },
          },
          http_projections: #{ maxItems: 0 },
          operation_keys: #{ maxItems: 0 },
          rpc_operation_keys: #{ maxItems: 0 },
        },
      },
    },
    #{
      `if`: #{
        properties: #{ kind: #{ `const`: "api" } },
        required: #["kind"],
      },
      `then`: #{
        `not`: #{ required: #["page_route"] },
        properties: #{
          source: #{
            properties: #{
              lambda_source: #{ pattern: "^src/routes/(.+/)?lambda\\.rs$" },
              role: #{ `enum`: #["api_server", "admin_api_server"] },
            },
          },
          operation_keys: #{ minItems: 1 },
        },
      },
    },
    #{
      `if`: #{
        properties: #{ carrier: #{ `const`: "direct_invoke" } },
        required: #["carrier"],
      },
      `then`: #{
        properties: #{
          kind: #{ `const`: "api" },
          provider: #{ `const`: "aws" },
          http_projections: #{ maxItems: 0 },
          rpc_operation_keys: #{ maxItems: 0 },
        },
      },
    },
  ]
)
model LambdaFunctionBuildUnitV2 {
  @minLength(1)
  id: string;
  provider: LambdaBuildProvider;
  kind: LambdaFunctionKind;

  @doc("Physical trust carrier selected at build time. Hosts MUST NOT sniff invocation bytes to switch carriers. Web units require http_ingress. Current tooling refuses gcp + direct_invoke until a provider canary exists.")
  carrier: LambdaCarrier;

  source: LambdaSourceIdentityV2;

  @pattern("^build/lambda/(aws|gcp)/funcs/(web|api)/(http_ingress|direct_invoke)/")
  build_dir: string;

  @minLength(1)
  wrapper_main: string;
  @minLength(1)
  source_copy: string;
  page_route?: AbsolutePath;
  http_projections: LambdaHttpProjectionV2[];

  @doc("Closed semantic operation inventory for one API physical function. Non-empty for API units and empty for web units.")
  @uniqueItems
  operation_keys: OperationKey[];

  @doc("Public /v1/rpc publication subset for an http_ingress API function. May be empty. Tooling MUST enforce rpc_operation_keys is a subset of operation_keys. direct_invoke units MUST keep this empty.")
  @uniqueItems
  rpc_operation_keys: OperationKey[];
}

@id("LambdaBuildManifestV2")
model LambdaBuildManifestV2 {
  schema_version: "ores.lambda.build.v2";
  generated_by: "ores-stack";
  functions: LambdaFunctionBuildUnitV2[];
}

// Cross-field rules are mirrored in JSON Schema above and remain independently
// enforced in Rust as a second runtime boundary:
// - web => http_ingress + page_route + empty API arrays;
// - api => non-empty operation_keys;
// - rpc_operation_keys ⊆ operation_keys;
// - each HTTP projection operation_key ∈ operation_keys;
// - http_ingress API semantic operations must be reachable through HTTP and/or RPC;
// - direct_invoke => no HTTP projections and no public RPC publication;
// - gcp + direct_invoke is currently refused pending an executable canary;
// - deterministic id/build_dir/wrapper_main/source_copy are recomputed by tooling.
