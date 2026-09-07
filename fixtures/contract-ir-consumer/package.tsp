using TypeSpec.JsonSchema;
namespace Zed.Conformance;

// Independently authored test input; never generated from the peer schema.
@id("PackageInstallIntent")
model PackageInstallIntent {
  package: string;
  version: string;
  dryRun: boolean;
}
