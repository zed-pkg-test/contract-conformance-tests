use std::path::PathBuf;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositoryAuditOptions {
    pub path: PathBuf,
    pub profile: String,
    pub additional_required_paths: Vec<String>,
}

mod zpkg_manifest;
