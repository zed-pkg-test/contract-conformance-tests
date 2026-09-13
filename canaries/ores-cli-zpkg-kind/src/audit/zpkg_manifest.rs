use std::fs;
use std::path::Path;

use serde_json::json;
use toml::Value;

use super::RepositoryAuditOptions;
use crate::model::{CommandReport, Finding};

const MANIFEST: &str = ".zpkg.toml";

/// Add conservative Zed manifest checks to repository audit.
///
/// `zed validate` remains the canonical executable validator. This static pass
/// only rejects fleet mistakes that have already proven harmful and can be
/// identified without reimplementing Zed's schema. In particular,
/// `package.kind` is not part of the canonical Zed package model; package role
/// is expressed by repository naming, targets and other supported metadata.
pub(super) fn augment_zpkg_manifest_audit(
    options: &RepositoryAuditOptions,
    mut report: CommandReport,
) -> CommandReport {
    let path = options.path.join(MANIFEST);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return report.finalize(),
        Err(error) => {
            report.push(
                Finding::warning(
                    "zpkg-manifest-unreadable",
                    format!("could not inspect {MANIFEST}: {error}"),
                )
                .with_target(MANIFEST),
            );
            return report.finalize();
        }
    };

    if metadata.file_type().is_symlink() || !metadata.is_file() {
        report.push(
            Finding::error(
                "zpkg-manifest-not-regular",
                ".zpkg.toml must be a repository-owned regular file",
            )
            .with_target(MANIFEST),
        );
        return report.finalize();
    }

    let source = match fs::read_to_string(&path) {
        Ok(source) => source,
        Err(error) => {
            report.push(
                Finding::error(
                    "zpkg-manifest-unreadable",
                    format!("could not read {MANIFEST} as UTF-8: {error}"),
                )
                .with_target(MANIFEST),
            );
            return report.finalize();
        }
    };
    let document = match source.parse::<Value>() {
        Ok(document) => document,
        Err(error) => {
            report.push(
                Finding::error(
                    "zpkg-manifest-invalid",
                    format!("could not parse {MANIFEST}: {error}"),
                )
                .with_target(MANIFEST),
            );
            return report.finalize();
        }
    };

    report.insert_metadata("zpkgManifestInspected", json!(true));

    if document
        .get("package")
        .and_then(Value::as_table)
        .is_some_and(|package| package.contains_key("kind"))
    {
        report.push(
            Finding::error(
                "zpkg-package-kind-noncanonical",
                "`package.kind` is not canonical Zed manifest metadata; express package role through supported targets/naming and require `zed validate` for full admission",
            )
            .with_target(MANIFEST)
            .with_detail("field", json!("package.kind")),
        );
    }

    report.finalize()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::augment_zpkg_manifest_audit;
    use crate::audit::RepositoryAuditOptions;
    use crate::model::CommandReport;

    fn audit(source: &str) -> CommandReport {
        let root = tempdir().expect("temporary repository");
        fs::write(root.path().join(".zpkg.toml"), source).expect("manifest");
        augment_zpkg_manifest_audit(
            &RepositoryAuditOptions {
                path: root.path().to_path_buf(),
                profile: "baseline".to_owned(),
                additional_required_paths: Vec::new(),
            },
            CommandReport::new("audit repo"),
        )
    }

    #[test]
    fn rejects_noncanonical_package_kind() {
        let report = audit(
            r#"[package]
org = "oresoftware"
name = "ores-dnd"
version = "0.1.0"
kind = "pub-lib-core"
"#,
        );
        assert!(
            report
                .findings
                .iter()
                .any(|finding| finding.code == "zpkg-package-kind-noncanonical")
        );
    }

    #[test]
    fn accepts_supported_package_shape_without_kind() {
        let report = audit(
            r#"[package]
org = "oresoftware"
name = "ores-dnd"
version = "0.1.0"
description = "cross-runtime drag and drop"

[targets.rust]
dir = "src/rust"
adapter = "rust"
"#,
        );
        assert!(
            !report
                .findings
                .iter()
                .any(|finding| finding.code == "zpkg-package-kind-noncanonical")
        );
    }
}
