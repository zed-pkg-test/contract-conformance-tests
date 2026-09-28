use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use thiserror::Error;

pub const CANONICAL_COMPOSE_FILE: &str = ".ores-compose.yaml";
pub const COMPAT_COMPOSE_FILE: &str = "ores-compose.yaml";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleCommand {
    Doctor,
    Status,
    Plan,
    Up,
    Down,
    Reload,
    Update,
    Rollback,
    Routes,
    Logs,
    Deploy,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum DeploySource {
    GitRepository {
        repository: String,
        revision: Option<String>,
        subdir: Option<String>,
    },
    GitHubOrganization {
        organization: String,
        repository_filter: Option<String>,
        revision: Option<String>,
    },
    LocalFolder {
        path: PathBuf,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteDiscoveryMode {
    ComposeAuthority,
    ComposeAndBuildMetadata,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocsGenerationMode {
    Disabled,
    ConsumerOwned,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeployRequest {
    pub source: DeploySource,
    pub compose_file: String,
    pub route_discovery: RouteDiscoveryMode,
    pub docs_generation: DocsGenerationMode,
    pub api_docs_revision: Option<String>,
}

impl DeployRequest {
    pub fn canonical(source: DeploySource, api_docs_revision: impl Into<String>) -> Self {
        return Self {
            source,
            compose_file: CANONICAL_COMPOSE_FILE.to_string(),
            route_discovery: RouteDiscoveryMode::ComposeAndBuildMetadata,
            docs_generation: DocsGenerationMode::ConsumerOwned,
            api_docs_revision: Some(api_docs_revision.into()),
        };
    }

    pub fn without_docs(source: DeploySource) -> Self {
        return Self {
            source,
            compose_file: CANONICAL_COMPOSE_FILE.to_string(),
            route_discovery: RouteDiscoveryMode::ComposeAndBuildMetadata,
            docs_generation: DocsGenerationMode::Disabled,
            api_docs_revision: None,
        };
    }

    pub fn validate(&self) -> Result<(), DeployRequestError> {
        if self.compose_file != CANONICAL_COMPOSE_FILE && self.compose_file != COMPAT_COMPOSE_FILE {
            return Err(DeployRequestError::UnsupportedComposeFile(
                self.compose_file.clone(),
            ));
        }

        match &self.source {
            DeploySource::GitRepository {
                repository,
                revision,
                subdir,
            } => {
                if repository.trim().is_empty() {
                    return Err(DeployRequestError::EmptyRepository);
                }

                let revision = revision
                    .as_deref()
                    .ok_or(DeployRequestError::MissingImmutableRevision)?;

                if !is_full_git_object_id(revision) {
                    return Err(DeployRequestError::MutableRevision(revision.to_string()));
                }

                if let Some(subdir) = subdir {
                    validate_relative_subdir(subdir)?;
                }
            }
            DeploySource::GitHubOrganization {
                organization,
                repository_filter,
                revision,
            } => {
                if organization.trim().is_empty() {
                    return Err(DeployRequestError::EmptyOrganization);
                }

                if matches!(repository_filter.as_deref(), Some("")) {
                    return Err(DeployRequestError::EmptyRepositoryFilter);
                }

                if matches!(revision.as_deref(), Some("latest" | "main" | "master")) {
                    return Err(DeployRequestError::MutableRevision(
                        revision.clone().unwrap_or_default(),
                    ));
                }
            }
            DeploySource::LocalFolder { path } => {
                if path.as_os_str().is_empty() {
                    return Err(DeployRequestError::EmptyLocalFolder);
                }
            }
        }

        match self.docs_generation {
            DocsGenerationMode::Disabled => {
                if self.api_docs_revision.is_some() {
                    return Err(DeployRequestError::UnexpectedApiDocsRevision);
                }
            }
            DocsGenerationMode::ConsumerOwned => {
                let revision = self
                    .api_docs_revision
                    .as_deref()
                    .ok_or(DeployRequestError::MissingApiDocsRevision)?;

                if !is_full_git_object_id(revision) {
                    return Err(DeployRequestError::MutableApiDocsRevision(
                        revision.to_string(),
                    ));
                }
            }
        }

        return Ok(());
    }
}

fn is_full_git_object_id(value: &str) -> bool {
    let length = value.len();

    if length != 40 && length != 64 {
        return false;
    }

    return value.bytes().all(|byte| byte.is_ascii_hexdigit());
}

fn validate_relative_subdir(subdir: &str) -> Result<(), DeployRequestError> {
    if subdir.trim().is_empty() {
        return Err(DeployRequestError::InvalidSubdir(subdir.to_string()));
    }

    let path = std::path::Path::new(subdir);

    if path.is_absolute() {
        return Err(DeployRequestError::InvalidSubdir(subdir.to_string()));
    }

    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)) {
            return Err(DeployRequestError::InvalidSubdir(subdir.to_string()));
        }
    }

    return Ok(());
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum ControlPayload {
    Deploy(DeployRequest),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ControlRequest {
    pub request_id: String,
    pub product_id: String,
    pub command: LifecycleCommand,
    pub generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<ControlPayload>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ControlResponse {
    pub request_id: String,
    pub accepted: bool,
    pub generation: Option<u64>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedCliConfig {
    pub product_id: String,
    pub daemon_endpoint: SocketAddr,
    pub token_file: PathBuf,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DeployRequestError {
    #[error("repository must not be empty")]
    EmptyRepository,
    #[error("organization must not be empty")]
    EmptyOrganization,
    #[error("repository_filter must not be empty when supplied")]
    EmptyRepositoryFilter,
    #[error("local folder must not be empty")]
    EmptyLocalFolder,
    #[error("unsupported ores-compose manifest name: {0}")]
    UnsupportedComposeFile(String),
    #[error("single-repository deployment requires a full immutable Git object id")]
    MissingImmutableRevision,
    #[error("deployment source must resolve to an immutable revision: {0}")]
    MutableRevision(String),
    #[error("invalid repository subdirectory: {0}")]
    InvalidSubdir(String),
    #[error("consumer-owned api-docs generation requires a pinned revision")]
    MissingApiDocsRevision,
    #[error("api-docs generation must pin a full immutable Git object id: {0}")]
    MutableApiDocsRevision(String),
    #[error("api_docs_revision must be absent when docs generation is disabled")]
    UnexpectedApiDocsRevision,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CliConfigError {
    #[error("product_id must not be empty")]
    EmptyProductId,
    #[error("daemon endpoint must be loopback")]
    NonLoopbackDaemon,
    #[error("token_file must be a filesystem path supplied by resolved runtime configuration")]
    MissingTokenFile,
    #[error("token_file must be an absolute path")]
    RelativeTokenFile,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CliAdapterError {
    #[error("product CLI adapter failed to resolve configuration: {0}")]
    ProductConfig(String),
    #[error("shared CLI validation failed: {0}")]
    SharedConfig(CliConfigError),
    #[error("CLI product identity mismatch: expected {expected}, got {actual}")]
    ProductIdMismatch { expected: String, actual: String },
}

pub trait ProductCliAdapter {
    fn product_id(&self) -> &str;
    fn resolved_config(&self) -> Result<ResolvedCliConfig, String>;
}

pub trait ControlTransport {
    fn send(&self, config: &ResolvedCliConfig, request: &ControlRequest) -> Result<ControlResponse, String>;
}

impl ResolvedCliConfig {
    pub fn loopback(product_id: impl Into<String>, port: u16, token_file: PathBuf) -> Result<Self, CliConfigError> {
        let config = Self {
            product_id: product_id.into(),
            daemon_endpoint: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
            token_file,
        };

        return config.validate().map(|()| config);
    }

    pub fn validate(&self) -> Result<(), CliConfigError> {
        if self.product_id.trim().is_empty() {
            return Err(CliConfigError::EmptyProductId);
        }

        if !self.daemon_endpoint.ip().is_loopback() {
            return Err(CliConfigError::NonLoopbackDaemon);
        }

        if self.token_file.as_os_str().is_empty() {
            return Err(CliConfigError::MissingTokenFile);
        }

        if !self.token_file.is_absolute() {
            return Err(CliConfigError::RelativeTokenFile);
        }

        return Ok(());
    }
}

pub fn config_from_adapter<A: ProductCliAdapter>(adapter: &A) -> Result<ResolvedCliConfig, CliAdapterError> {
    let config = adapter
        .resolved_config()
        .map_err(CliAdapterError::ProductConfig)?;

    config.validate().map_err(CliAdapterError::SharedConfig)?;

    if config.product_id != adapter.product_id() {
        return Err(CliAdapterError::ProductIdMismatch {
            expected: adapter.product_id().to_string(),
            actual: config.product_id,
        });
    }

    return Ok(config);
}

pub fn request(request_id: impl Into<String>, product_id: impl Into<String>, command: LifecycleCommand) -> ControlRequest {
    return ControlRequest {
        request_id: request_id.into(),
        product_id: product_id.into(),
        command,
        generation: None,
        payload: None,
    };
}

pub fn deployment_request(
    request_id: impl Into<String>,
    product_id: impl Into<String>,
    deploy: DeployRequest,
) -> Result<ControlRequest, DeployRequestError> {
    deploy.validate()?;

    return Ok(ControlRequest {
        request_id: request_id.into(),
        product_id: product_id.into(),
        command: LifecycleCommand::Deploy,
        generation: None,
        payload: Some(ControlPayload::Deploy(deploy)),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const PINNED_SHA: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn loopback_constructor_is_safe_by_default() {
        let config = ResolvedCliConfig::loopback(
            "beamscale",
            8765,
            PathBuf::from("/tmp/desktop-daemon.token"),
        )
        .expect("valid loopback config");

        assert!(config.daemon_endpoint.ip().is_loopback());
    }

    #[test]
    fn deployment_can_point_at_repo_with_compose_authority() {
        let deploy = DeployRequest::canonical(
            DeploySource::GitRepository {
                repository: "https://github.com/example/app".to_string(),
                revision: Some(PINNED_SHA.to_string()),
                subdir: None,
            },
            PINNED_SHA,
        );
        let request = deployment_request("req-1", "scintilla", deploy)
            .expect("immutable deployment source should validate");

        assert_eq!(request.command, LifecycleCommand::Deploy);
        assert!(matches!(request.payload, Some(ControlPayload::Deploy(_))));
    }

    #[test]
    fn branch_name_deployment_is_rejected() {
        let deploy = DeployRequest::canonical(
            DeploySource::GitRepository {
                repository: "https://github.com/example/app".to_string(),
                revision: Some("feature/not-immutable".to_string()),
                subdir: None,
            },
            PINNED_SHA,
        );

        assert!(matches!(
            deploy.validate(),
            Err(DeployRequestError::MutableRevision(_))
        ));
    }

    #[test]
    fn parent_directory_subdir_is_rejected() {
        let deploy = DeployRequest::canonical(
            DeploySource::GitRepository {
                repository: "https://github.com/example/app".to_string(),
                revision: Some(PINNED_SHA.to_string()),
                subdir: Some("../other".to_string()),
            },
            PINNED_SHA,
        );

        assert!(matches!(
            deploy.validate(),
            Err(DeployRequestError::InvalidSubdir(_))
        ));
    }

    #[test]
    fn docs_require_immutable_api_docs_revision() {
        let deploy = DeployRequest {
            source: DeploySource::LocalFolder {
                path: PathBuf::from("/work/app"),
            },
            compose_file: CANONICAL_COMPOSE_FILE.to_string(),
            route_discovery: RouteDiscoveryMode::ComposeAndBuildMetadata,
            docs_generation: DocsGenerationMode::ConsumerOwned,
            api_docs_revision: Some("main".to_string()),
        };

        assert!(matches!(
            deploy.validate(),
            Err(DeployRequestError::MutableApiDocsRevision(_))
        ));
    }

    struct TestCliAdapter;

    impl ProductCliAdapter for TestCliAdapter {
        fn product_id(&self) -> &str {
            return "scintilla";
        }

        fn resolved_config(&self) -> Result<ResolvedCliConfig, String> {
            return ResolvedCliConfig::loopback(
                "scintilla",
                8765,
                PathBuf::from("/tmp/scintilla.token"),
            )
            .map_err(|error| error.to_string());
        }
    }

    #[test]
    fn thin_cli_entrypoint_can_delegate_resolved_config() {
        let config = config_from_adapter(&TestCliAdapter).expect("adapter config should validate");

        assert_eq!(config.product_id, "scintilla");
        assert!(config.daemon_endpoint.ip().is_loopback());
    }
}
