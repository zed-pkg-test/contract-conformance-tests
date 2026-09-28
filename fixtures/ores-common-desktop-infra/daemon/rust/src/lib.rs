use ores_common_desktop_cli::{DeployRequest, DocsGenerationMode};
use ores_common_desktop_infra::{DesiredState, RouteChange};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;

pub const DEFAULT_AUTH_ISSUER: &str = "https://ores-shared-auth.com";
pub const OTEL_EVENT_PREFIX: &str = "ores.desktop";
pub const DEPLOY_SCOPE: &str = "ores.desktop.deploy";

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Transition {
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
#[serde(rename_all = "snake_case")]
pub enum UpdateStage {
    Staged,
    Verified,
    HotReloading,
    Restarting,
    HealthChecking,
    Draining,
    Committed,
    RollingBack,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentStage {
    SourceResolved,
    ComposeValidated,
    ContractsDiscovered,
    DocsGenerated,
    WorkersStaged,
    RoutesPrepared,
    Activated,
    OldGenerationDraining,
    Committed,
    RollingBack,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerActivation {
    Reuse,
    StartChild,
    RestartChild,
    BeamHotLoad,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkerDeployment {
    pub service_id: String,
    pub revision: String,
    pub activation: WorkerActivation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocsArtifactPlan {
    pub api_docs_revision: String,
    pub publication_mode: String,
    pub semantic_contract_sha256: String,
    pub output_dir: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeploymentPlan {
    pub deployment_id: String,
    pub product_id: String,
    pub generation: u64,
    pub workers: Vec<WorkerDeployment>,
    pub route_changes: Vec<RouteChange>,
    pub docs: Option<DocsArtifactPlan>,
    pub full_appliance_restart_required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DevicePlatform {
    Desktop,
    Android,
    Ios,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostingRole {
    ClientOnly,
    ClientAndWorker,
    ClientAndServer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceCapabilities {
    pub platform: DevicePlatform,
    pub hosting_role: HostingRole,
    pub supports_wasm: bool,
    pub supports_native_workers: bool,
    pub supports_persistent_service: bool,
    pub supports_inbound_listener: bool,
    pub background_execution_limited: bool,
}

impl DeviceCapabilities {
    pub fn can_host_worker(&self) -> bool {
        if self.hosting_role == HostingRole::ClientOnly {
            return false;
        }

        return self.supports_wasm || self.supports_native_workers;
    }

    pub fn can_host_persistent_backend(&self) -> bool {
        if self.hosting_role != HostingRole::ClientAndServer {
            return false;
        }

        if self.background_execution_limited {
            return false;
        }

        return self.supports_persistent_service;
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DaemonPolicy {
    pub product_id: String,
    pub listen_addr: SocketAddr,
    pub token_file: PathBuf,
    pub auth_issuer: String,
    pub allowed_transitions: BTreeSet<Transition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticatedPrincipal {
    pub subject: String,
    pub device_id: Option<String>,
    pub scopes: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateComponent {
    pub component_id: String,
    pub from_revision: String,
    pub to_revision: String,
    pub expected_digest: Option<String>,
    pub hot_reloadable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdatePlan {
    pub update_id: String,
    pub components: Vec<UpdateComponent>,
    pub drain_timeout_ms: u64,
}

impl UpdatePlan {
    pub fn drain_timeout(&self) -> Duration {
        return Duration::from_millis(self.drain_timeout_ms);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TelemetryEvent {
    pub event_name: String,
    pub product_id: String,
    pub generation: Option<u64>,
    pub update_id: Option<String>,
    pub update_stage: Option<UpdateStage>,
    pub deployment_id: Option<String>,
    pub deployment_stage: Option<DeploymentStage>,
}

/// Implement this with the product's `ores-otel` adapter. Shared code emits
/// stable ORES event names; product entrypoints attach service/resource fields.
pub trait TelemetrySink: Send + Sync {
    fn emit(&self, event: TelemetryEvent);
}

/// Thin seam implemented by each distinct product desktop-daemon entrypoint.
/// The entrypoint resolves product flags/auth/telemetry, then delegates named
/// transitions here rather than recreating the common policy loop.
pub trait ProductDaemonAdapter {
    fn product_id(&self) -> &str;
    fn apply_transition(&self, transition: &Transition, desired_state: &DesiredState) -> Result<(), String>;
}

/// Product-specific source/materialization logic lives behind this seam. The
/// shared daemon owns admission, zero-appliance-restart policy, route commit
/// ordering, telemetry vocabulary, and shared-auth authorization.
pub trait ProductDeploymentAdapter {
    fn product_id(&self) -> &str;
    fn plan_deployment(&self, request: &DeployRequest, generation: u64) -> Result<DeploymentPlan, String>;
    fn activate_deployment(&self, plan: &DeploymentPlan) -> Result<(), String>;
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PolicyError {
    #[error("daemon must bind to loopback by default")]
    NonLoopbackBind,
    #[error("token_file is required")]
    MissingTokenFile,
    #[error("auth issuer is required")]
    MissingAuthIssuer,
    #[error("transition is not allowed by daemon policy: {0:?}")]
    TransitionDenied(Transition),
    #[error("update component must use an exact non-empty revision: {0}")]
    MutableRevision(String),
    #[error("principal is missing required scope: {0}")]
    MissingScope(String),
    #[error("product identity mismatch: expected {expected}, got {actual}")]
    ProductIdMismatch { expected: String, actual: String },
    #[error("product transition failed: {0}")]
    ProductTransition(String),
    #[error("invalid deploy request: {0}")]
    InvalidDeployRequest(String),
    #[error("product deployment planning failed: {0}")]
    DeploymentPlanning(String),
    #[error("product deployment activation failed: {0}")]
    DeploymentActivation(String),
    #[error("ordinary application deployment must not restart the complete desktop appliance")]
    UnexpectedApplianceRestart,
    #[error("deployment worker must use an exact revision: {0}")]
    MutableWorkerRevision(String),
    #[error("consumer-owned deterministic docs require a pinned api-docs revision")]
    MissingApiDocsRevision,
    #[error("deployment docs must use consumer_owned publication mode")]
    InvalidDocsPublicationMode,
}

pub fn validate_policy(policy: &DaemonPolicy) -> Result<(), PolicyError> {
    if !policy.listen_addr.ip().is_loopback() {
        return Err(PolicyError::NonLoopbackBind);
    }

    if policy.token_file.as_os_str().is_empty() {
        return Err(PolicyError::MissingTokenFile);
    }

    if policy.auth_issuer.trim().is_empty() {
        return Err(PolicyError::MissingAuthIssuer);
    }

    return Ok(());
}

pub fn authorize_transition(policy: &DaemonPolicy, transition: Transition) -> Result<(), PolicyError> {
    if !policy.allowed_transitions.contains(&transition) {
        return Err(PolicyError::TransitionDenied(transition));
    }

    return Ok(());
}

pub fn authorize_scope(principal: &AuthenticatedPrincipal, required_scope: &str) -> Result<(), PolicyError> {
    if !principal.scopes.contains(required_scope) {
        return Err(PolicyError::MissingScope(required_scope.to_string()));
    }

    return Ok(());
}

pub fn validate_update_plan(plan: &UpdatePlan) -> Result<(), PolicyError> {
    for component in &plan.components {
        if component.to_revision.trim().is_empty() || component.to_revision == "latest" {
            return Err(PolicyError::MutableRevision(component.component_id.clone()));
        }
    }

    return Ok(());
}

pub fn validate_deployment_plan(request: &DeployRequest, plan: &DeploymentPlan) -> Result<(), PolicyError> {
    request
        .validate()
        .map_err(|error| PolicyError::InvalidDeployRequest(error.to_string()))?;

    if plan.full_appliance_restart_required {
        return Err(PolicyError::UnexpectedApplianceRestart);
    }

    for worker in &plan.workers {
        if worker.revision.trim().is_empty() || worker.revision == "latest" {
            return Err(PolicyError::MutableWorkerRevision(worker.service_id.clone()));
        }
    }

    if request.docs_generation == DocsGenerationMode::ConsumerOwned {
        let docs = plan.docs.as_ref().ok_or(PolicyError::MissingApiDocsRevision)?;

        if docs.api_docs_revision.trim().is_empty()
            || matches!(docs.api_docs_revision.as_str(), "latest" | "main" | "master")
        {
            return Err(PolicyError::MissingApiDocsRevision);
        }

        if docs.publication_mode != "consumer_owned" {
            return Err(PolicyError::InvalidDocsPublicationMode);
        }
    }

    return Ok(());
}

pub fn execute_transition<A: ProductDaemonAdapter>(
    policy: &DaemonPolicy,
    adapter: &A,
    transition: Transition,
    desired_state: &DesiredState,
) -> Result<(), PolicyError> {
    validate_policy(policy)?;

    if policy.product_id != adapter.product_id() {
        return Err(PolicyError::ProductIdMismatch {
            expected: policy.product_id.clone(),
            actual: adapter.product_id().to_string(),
        });
    }

    if desired_state.product_id != policy.product_id {
        return Err(PolicyError::ProductIdMismatch {
            expected: policy.product_id.clone(),
            actual: desired_state.product_id.clone(),
        });
    }

    authorize_transition(policy, transition.clone())?;
    adapter
        .apply_transition(&transition, desired_state)
        .map_err(PolicyError::ProductTransition)?;

    return Ok(());
}

pub fn execute_deployment<A: ProductDeploymentAdapter>(
    policy: &DaemonPolicy,
    principal: &AuthenticatedPrincipal,
    adapter: &A,
    request: &DeployRequest,
    generation: u64,
) -> Result<DeploymentPlan, PolicyError> {
    validate_policy(policy)?;
    authorize_transition(policy, Transition::Deploy)?;
    authorize_scope(principal, DEPLOY_SCOPE)?;

    request
        .validate()
        .map_err(|error| PolicyError::InvalidDeployRequest(error.to_string()))?;

    if policy.product_id != adapter.product_id() {
        return Err(PolicyError::ProductIdMismatch {
            expected: policy.product_id.clone(),
            actual: adapter.product_id().to_string(),
        });
    }

    let plan = adapter
        .plan_deployment(request, generation)
        .map_err(PolicyError::DeploymentPlanning)?;

    if plan.product_id != policy.product_id {
        return Err(PolicyError::ProductIdMismatch {
            expected: policy.product_id.clone(),
            actual: plan.product_id.clone(),
        });
    }

    validate_deployment_plan(request, &plan)?;
    adapter
        .activate_deployment(&plan)
        .map_err(PolicyError::DeploymentActivation)?;

    return Ok(plan);
}

pub fn planned_generation_event(state: &DesiredState) -> TelemetryEvent {
    return TelemetryEvent {
        event_name: format!("{OTEL_EVENT_PREFIX}.desired_state.planned"),
        product_id: state.product_id.clone(),
        generation: Some(state.generation),
        update_id: None,
        update_stage: None,
        deployment_id: None,
        deployment_stage: None,
    };
}

pub fn update_stage_event(product_id: &str, update_id: &str, stage: UpdateStage) -> TelemetryEvent {
    return TelemetryEvent {
        event_name: format!("{OTEL_EVENT_PREFIX}.update.stage"),
        product_id: product_id.to_string(),
        generation: None,
        update_id: Some(update_id.to_string()),
        update_stage: Some(stage),
        deployment_id: None,
        deployment_stage: None,
    };
}

pub fn deployment_stage_event(
    product_id: &str,
    deployment_id: &str,
    generation: u64,
    stage: DeploymentStage,
) -> TelemetryEvent {
    return TelemetryEvent {
        event_name: format!("{OTEL_EVENT_PREFIX}.deployment.stage"),
        product_id: product_id.to_string(),
        generation: Some(generation),
        update_id: None,
        update_stage: None,
        deployment_id: Some(deployment_id.to_string()),
        deployment_stage: Some(stage),
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use ores_common_desktop_cli::{DeploySource, RouteDiscoveryMode};
    use ores_common_desktop_infra::RouteAuthority;
    use std::collections::{BTreeMap, BTreeSet};
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn remote_bind_is_rejected() {
        let policy = DaemonPolicy {
            product_id: "wasmx".to_string(),
            listen_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 8765),
            token_file: PathBuf::from("/tmp/token"),
            auth_issuer: DEFAULT_AUTH_ISSUER.to_string(),
            allowed_transitions: BTreeSet::new(),
        };

        assert_eq!(validate_policy(&policy), Err(PolicyError::NonLoopbackBind));
    }

    #[test]
    fn arbitrary_transitions_are_not_implicitly_authorized() {
        let policy = DaemonPolicy {
            product_id: "beamscale".to_string(),
            listen_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8765),
            token_file: PathBuf::from("/tmp/token"),
            auth_issuer: DEFAULT_AUTH_ISSUER.to_string(),
            allowed_transitions: BTreeSet::from([Transition::Status]),
        };

        assert!(matches!(
            authorize_transition(&policy, Transition::Update),
            Err(PolicyError::TransitionDenied(Transition::Update))
        ));
    }

    #[test]
    fn hosting_is_capability_negotiated_not_platform_assumed() {
        let constrained_mobile = DeviceCapabilities {
            platform: DevicePlatform::Ios,
            hosting_role: HostingRole::ClientAndServer,
            supports_wasm: true,
            supports_native_workers: false,
            supports_persistent_service: true,
            supports_inbound_listener: false,
            background_execution_limited: true,
        };

        assert!(constrained_mobile.can_host_worker());
        assert!(!constrained_mobile.can_host_persistent_backend());
    }

    #[test]
    fn ordinary_app_deploy_cannot_restart_entire_appliance() {
        let request = DeployRequest {
            source: DeploySource::LocalFolder {
                path: PathBuf::from("/work/app"),
            },
            compose_file: ".ores-compose.yaml".to_string(),
            route_discovery: RouteDiscoveryMode::ComposeAndBuildMetadata,
            docs_generation: DocsGenerationMode::Disabled,
            api_docs_revision: None,
        };
        let plan = DeploymentPlan {
            deployment_id: "deploy-1".to_string(),
            product_id: "scintilla".to_string(),
            generation: 3,
            workers: vec![],
            route_changes: vec![],
            docs: None,
            full_appliance_restart_required: true,
        };

        assert_eq!(
            validate_deployment_plan(&request, &plan),
            Err(PolicyError::UnexpectedApplianceRestart)
        );
    }

    struct TestDaemonAdapter;

    impl ProductDaemonAdapter for TestDaemonAdapter {
        fn product_id(&self) -> &str {
            return "scintilla";
        }

        fn apply_transition(&self, _transition: &Transition, _desired_state: &DesiredState) -> Result<(), String> {
            return Ok(());
        }
    }

    #[test]
    fn product_daemon_entrypoint_can_delegate_named_transition() {
        let policy = DaemonPolicy {
            product_id: "scintilla".to_string(),
            listen_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8765),
            token_file: PathBuf::from("/tmp/scintilla.token"),
            auth_issuer: DEFAULT_AUTH_ISSUER.to_string(),
            allowed_transitions: BTreeSet::from([Transition::Reload]),
        };
        let state = DesiredState {
            product_id: "scintilla".to_string(),
            generation: 2,
            route_authority: RouteAuthority::Erlang,
            routes: vec![],
            services: vec![],
            labels: BTreeMap::new(),
        };

        assert_eq!(
            execute_transition(&policy, &TestDaemonAdapter, Transition::Reload, &state),
            Ok(())
        );
    }
}
