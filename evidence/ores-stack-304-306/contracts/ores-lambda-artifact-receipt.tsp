import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace OresLambdaArtifactReceipt;

@pattern("^[0-9a-f]{64}$")
scalar Sha256Hex extends string;

@pattern("^[0-9a-f]{40}$")
scalar GitSha extends string;

@pattern("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
scalar RepositoryIdentity extends string;

enum LambdaArtifactProvider {
  aws,
  gcp,
}

enum LambdaArtifactKind {
  web,
  api,
}

enum LambdaArtifactCarrier {
  http_ingress,
  direct_invoke,
}

enum LambdaBuildArchitecture {
  x86_64,
  arm64,
}

@id("LambdaArtifactReceiptV2")
@extension(
  "allOf",
  #[
    #{
      `if`: #{
        properties: #{ provider: #{ `const`: "gcp" } },
        required: #["provider"],
      },
      `then`: #{
        properties: #{
          carrier: #{ `const`: "http_ingress" },
          architecture: #{ `const`: "x86_64" },
        },
      },
    },
    #{
      `if`: #{
        properties: #{ kind: #{ `const`: "web" } },
        required: #["kind"],
      },
      `then`: #{
        properties: #{ carrier: #{ `const`: "http_ingress" } },
      },
    },
    #{
      `if`: #{
        properties: #{ provider: #{ `const`: "aws" } },
        required: #["provider"],
      },
      `then`: #{
        properties: #{
          artifact_path: #{ pattern: "/artifact/(x86_64|arm64)/bootstrap\\.zip$" },
        },
      },
    },
    #{
      `if`: #{
        properties: #{ provider: #{ `const`: "gcp" } },
        required: #["provider"],
      },
      `then`: #{
        properties: #{
          artifact_path: #{ pattern: "/artifact/x86_64/service$" },
        },
      },
    },
  ]
)
model LambdaArtifactReceiptV2 {
  schema_version: "ores.lambda.artifact.receipt.v2";
  generated_by: "ores-stack";
  build_schema_version: "ores.lambda.build.v2";
  provider: LambdaArtifactProvider;
  kind: LambdaArtifactKind;
  carrier: LambdaArtifactCarrier;

  @doc("Architecture admitted from the packaged Linux ELF64 executable itself. Tooling MUST require little-endian ELF and e_machine equality with this value before emitting a receipt.")
  architecture: LambdaBuildArchitecture;

  repository: RepositoryIdentity;
  commit_sha: GitSha;

  @pattern("^src/(pages|routes)/(.+/)?lambda\\.rs$")
  lambda_source: string;

  @doc("SHA-256 declared by the build unit for the exact generated lambda.rs bytes.")
  lambda_source_sha256: Sha256Hex;
  @doc("SHA-256 of the serialized validated LambdaFunctionBuildUnit that authorized packaging.")
  build_unit_sha256: Sha256Hex;
  @doc("SHA-256 re-computed from materialized lambda.rs during packaging; tooling MUST require equality with lambda_source_sha256.")
  source_sha256: Sha256Hex;
  wrapper_sha256: Sha256Hex;
  executable_sha256: Sha256Hex;
  artifact_sha256: Sha256Hex;

  @pattern("^build/lambda/(aws|gcp)/funcs/(web|api)/(http_ingress|direct_invoke)/.+/artifact/(x86_64|arm64)/(bootstrap\\.zip|service)$")
  artifact_path: string;

  @doc("Artifact packaging never mutates provider/cloud deployment state.")
  deploy_mutation_performed: false;
}

// Tooling additionally enforces provider/carrier/architecture compatibility
// inherited from the validated build unit. The executable itself must be Linux
// ELF64 little-endian ET_EXEC/ET_DYN and its e_machine must equal architecture.
// In particular GCP is currently certified only for http_ingress + x86_64;
// direct_invoke and arm64 fail closed.
