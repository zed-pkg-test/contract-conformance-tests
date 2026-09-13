use std::path::PathBuf;

use crate::model::CommandReport;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositoryAuditOptions {
    pub path: PathBuf,
    pub profile: String,
    pub additional_required_paths: Vec<String>,
}

mod zpkg_manifest;

pub fn run_zpkg_manifest_audit(
    options: &RepositoryAuditOptions,
    report: CommandReport,
) -> CommandReport {
    zpkg_manifest::augment_zpkg_manifest_audit(options, report)
}
