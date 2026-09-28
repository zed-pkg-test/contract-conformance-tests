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
    HealthChecked,
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
pub struct ResolvedSourceEvidence {
    pub source_id: String,
    pub immutable_revision: String,
    pub content_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkerDeployment {
    pub service_id: String,
    pub revision: String,
    pub content_sha256: String,
    pub activation: WorkerActivation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocsArtifactPlan {
    pub api_docs_revision: String,
    pub publication_mode: String,
    pub semantic_contract_sha256: String,
    pub route_catalog_sha256: String,
    pub output_dir: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeploymentPlan {
    pub deployment_id: String,
    pub product_id: String,
    pub generation: u64,
    pub source_evidence: Vec<ResolvedSourceEvidence>,
    pub compose_sha256: String,
    pub route_catalog_sha256: String,
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
    pub expected_digest: String,
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

pub trait TelemetrySink: Send + Sync {
    fn emit(&self, event: TelemetryEvent);
}

pub trait ProductDaemonAdapter {
    fn product_id(&self) -> &str;
    fn apply_transition(&self, transition: &Transition, desired_state: &DesiredState) -> Result<(), String>;
}

/// Product adapters materialize product-specific workers and runtimes, but the
/// shared daemon owns transaction ordering. Implementations must not perform a
/// complete appliance restart from any of these deployment methods.
pub trait ProductDeploymentAdapter {
    fn product_id(&self) -> &str;
    fn plan_deployment(&self, request: &DeployRequest, generation: u64) -> Result<DeploymentPlan, String>;
    fn stage_deployment(&self, plan: &DeploymentPlan) -> Result<(), String>;
    fn health_check_deployment(&self, plan: &DeploymentPlan) -> Result<(), String>;
    fn activate_deployment(&self, plan: &DeploymentPlan) -> Result<(), String>;
    fn drain_previous_generation(&self, plan: &DeploymentPlan) -> Result<(), String>;
    fn commit_deployment(&self, plan: &DeploymentPlan) -> Result<(), String>;
    fn rollback_deployment(&self, plan: &DeploymentPlan) -> Result<(), String>;
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PolicyError {
    #[error("daemon must bind to loopback by default")]
    NonLoopbackBind,
    #[error("token_file is required")]
    MissingTokenFile,
    #[error("token_file must be an absolute path")]
    RelativeTokenFile,
    #[error("auth issuer is required")]
    MissingAuthIssuer,
    #[error("principal subject is required")]
    MissingPrincipalSubject,
    #[error("deployment requires a bound device identity")]
    MissingDeviceIdentity,
    #[error("transition is not allowed by daemon policy: {0:?}")]
    TransitionDenied(Transition),
    #[error("update component must use an exact non-empty revision: {0}")]
    MutableRevision(String),
    #[error("invalid sha256 digest for {0}")]
    InvalidDigest(String),
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
    #[error("deployment generation must be non-zero and match the requested generation")]
    InvalidGeneration,
    #[error("deployment_id must not be empty")]
    EmptyDeploymentId,
    #[error("deployment plan must contain immutable source evidence")]
    MissingSourceEvidence,
    #[error("resolved source is not immutable: {0}")]
    MutableResolvedSource(String),
    #[error("product deployment staging failed: {0}")]
    DeploymentStaging(String),
    #[error("product deployment health check failed: {0}")]
    DeploymentHealthCheck(String),
    #[error("product deployment activation failed: {0}")]
    DeploymentActivation(String),
    #[error("previous generation drain failed: {0}")]
    DeploymentDrain(String),
    #[error("deployment commit failed: {0}")]
    DeploymentCommit(String),
    #[error("deployment failed and rollback also failed: failure={failure}; rollback={rollback}")]
    DeploymentRollback { failure: String, rollback: String },
    #[error("ordinary application deployment must not restart the complete desktop appliance")]
    UnexpectedApplianceRestart,
    #[error("deployment worker must use an exact revision: {0}")]
    MutableWorkerRevision(String),
    #[error("consumer-owned deterministic docs require a pinned api-docs revision")]
    MissingApiDocsRevision,
    #[error("deployment docs must use consumer_owned publication mode")]
    InvalidDocsPublicationMode,
    #[error("deployment docs route-catalog digest does not match the activated route catalog")]
    DocsRouteCatalogMismatch,
}

pub fn validate_policy(policy: &DaemonPolicy) -> Result<(), PolicyError> {
    if !policy.listen_addr.ip().is_loopback() {
        return Err(PolicyError::NonLoopbackBind);
    }

    if policy.token_file.as_os_str().is_empty() {
        return Err(PolicyError::MissingTokenFile);
    }

    if !policy.token_file.is_absolute() {
        return Err(PolicyError::RelativeTokenFile);
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
    if principal.subject.trim().is_empty() {
        return Err(PolicyError::MissingPrincipalSubject);
    }

    if !principal.scopes.contains(required_scope) {
        return Err(PolicyError::MissingScope(required_scope.to_string()));
    }

    return Ok(());
}

pub fn authorize_deployment_principal(principal: &AuthenticatedPrincipal) -> Result<(), PolicyError> {
    authorize_scope(principal, DEPLOY_SCOPE)?;

    if principal
        .device_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return Err(PolicyError::MissingDeviceIdentity);
    }

    return Ok(());
}

pub fn validate_update_plan(plan: &UpdatePlan) -> Result<(), PolicyError> {
    for component in &plan.components {
        if component.to_revision.trim().is_empty()
            || matches!(component.to_revision.as_str(), "latest" | "main" | "master")
        {
            return Err(PolicyError::MutableRevision(component.component_id.clone()));
        }

        validate_sha256(&component.expected_digest, &component.component_id)?;
    }

    return Ok(());
}

pub fn validate_deployment_plan(
    request: &DeployRequest,
    expected_generation: u64,
    plan: &DeploymentPlan,
) -> Result<(), PolicyError> {
    request
        .validate()
        .map_err(|error| PolicyError::InvalidDeployRequest(error.to_string()))?;

    if expected_generation == 0 || plan.generation != expected_generation {
        return Err(PolicyError::InvalidGeneration);
    }

    if plan.deployment_id.trim().is_empty() {
        return Err(PolicyError::EmptyDeploymentId);
    }

    if plan.full_appliance_restart_required {
        return Err(PolicyError::UnexpectedApplianceRestart);
    }

    if plan.source_evidence.is_empty() {
        return Err(PolicyError::MissingSourceEvidence);
    }

    for source in &plan.source_evidence {
        if source.source_id.trim().is_empty() || !is_immutable_revision(&source.immutable_revision) {
            return Err(PolicyError::MutableResolvedSource(source.source_id.clone()));
        }

        validate_sha256(&source.content_sha256, &source.source_id)?;
    }

    validate_sha256(&plan.compose_sha256, "compose")?;
    validate_sha256(&plan.route_catalog_sha256, "route_catalog")?;

    for worker in &plan.workers {
        if worker.service_id.trim().is_empty()
            || worker.revision.trim().is_empty()
            || matches!(worker.revision.as_str(), "latest" | "main" | "master")
        {
            return Err(PolicyError::MutableWorkerRevision(worker.service_id.clone()));
        }

        validate_sha256(&worker.content_sha256, &worker.service_id)?;
    }

    if request.docs_generation == DocsGenerationMode::ConsumerOwned {
        let docs = plan.docs.as_ref().ok_or(PolicyError::MissingApiDocsRevision)?;

        if !is_git_object_id(&docs.api_docs_revision) {
            return Err(PolicyError::MissingApiDocsRevision);
        }

        if docs.publication_mode != "consumer_owned" {
            return Err(PolicyError::InvalidDocsPublicationMode);
        }

        validate_sha256(&docs.semantic_contract_sha256, "semantic_contract")?;
        validate_sha256(&docs.route_catalog_sha256, "docs_route_catalog")?;

        if docs.route_catalog_sha256 != plan.route_catalog_sha256 {
            return Err(PolicyError::DocsRouteCatalogMismatch);
        }
    }

    return Ok(());
}

fn validate_sha256(value: &str, label: &str) -> Result<(), PolicyError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(PolicyError::InvalidDigest(label.to_string()));
    }

    return Ok(());
}

fn is_git_object_id(value: &str) -> bool {
    return (value.len() == 40 || value.len() == 64)
        && value.bytes().all(|byte| byte.is_ascii_hexdigit());
}

fn is_immutable_revision(value: &str) -> bool {
    if is_git_object_id(value) {
        return true;
    }

    if let Some(digest) = value.strip_prefix("sha256:") {
        return digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit());
    }

    return false;
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
    authorize_deployment_principal(principal)?;

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

    validate_deployment_plan(request, generation, &plan)?;

    adapter
        .stage_deployment(&plan)
        .map_err(PolicyError::DeploymentStaging)?;

    if let Err(error) = adapter.health_check_deployment(&plan) {
        return rollback_after_failure(adapter, &plan, PolicyError::DeploymentHealthCheck(error));
    }

    if let Err(error) = adapter.activate_deployment(&plan) {
        return rollback_after_failure(adapter, &plan, PolicyError::DeploymentActivation(error));
    }

    if let Err(error) = adapter.drain_previous_generation(&plan) {
        return rollback_after_failure(adapter, &plan, PolicyError::DeploymentDrain(error));
    }

    if let Err(error) = adapter.commit_deployment(&plan) {
        return rollback_after_failure(adapter, &plan, PolicyError::DeploymentCommit(error));
    }

    return Ok(plan);
}

fn rollback_after_failure<A: ProductDeploymentAdapter>(
    adapter: &A,
    plan: &DeploymentPlan,
    failure: PolicyError,
) -> Result<DeploymentPlan, PolicyError> {
    match adapter.rollback_deployment(plan) {
        Ok(()) => {
            return Err(failure);
        }
        Err(rollback) => {
            return Err(PolicyError::DeploymentRollback {
                failure: failure.to_string(),
                rollback,
            });
        }
    }
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
    use std::sync::Mutex;

    const SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const GIT_SHA: &str = "0123456789abcdef0123456789abcdef01234567";

    fn policy() -> DaemonPolicy {
        return DaemonPolicy {
            product_id: "scintilla".to_string(),
            listen_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8765),
            token_file: PathBuf::from("/tmp/scintilla.token"),
            auth_issuer: DEFAULT_AUTH_ISSUER.to_string(),
            allowed_transitions: BTreeSet::from([Transition::Deploy, Transition::Reload]),
        };
    }

    fn request_without_docs() -> DeployRequest {
        return DeployRequest {
            source: DeploySource::LocalFolder {
                path: PathBuf::from("/work/app"),
            },
            compose_file: ".ores-compose.yaml".to_string(),
            route_discovery: RouteDiscoveryMode::ComposeAndBuildMetadata,
            docs_generation: DocsGenerationMode::Disabled,
            api_docs_revision: None,
        };
    }

    fn plan(restart: bool) -> DeploymentPlan {
        return DeploymentPlan {
            deployment_id: "deploy-1".to_string(),
            product_id: "scintilla".to_string(),
            generation: 3,
            source_evidence: vec![ResolvedSourceEvidence {
                source_id: "local:/work/app".to_string(),
                immutable_revision: format!("sha256:{SHA256}"),
                content_sha256: SHA256.to_string(),
            }],
            compose_sha256: SHA256.to_string(),
            route_catalog_sha256: SHA256.to_string(),
            workers: vec![],
            route_changes: vec![],
            docs: None,
            full_appliance_restart_required: restart,
        };
    }

    fn principal() -> AuthenticatedPrincipal {
        return AuthenticatedPrincipal {
            subject: "user-1".to_string(),
            device_id: Some("device-1".to_string()),
            scopes: BTreeSet::from([DEPLOY_SCOPE.to_string()]),
        };
    }

    #[test]
    fn remote_bind_is_rejected() {
        let mut policy = policy();
        policy.listen_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 8765);

        assert_eq!(validate_policy(&policy), Err(PolicyError::NonLoopbackBind));
    }

    #[test]
    fn arbitrary_transitions_are_not_implicitly_authorized() {
        let mut policy = policy();
        policy.allowed_transitions = BTreeSet::from([Transition::Status]);

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
        assert_eq!(
            validate_deployment_plan(&request_without_docs(), 3, &plan(true)),
            Err(PolicyError::UnexpectedApplianceRestart)
        );
    }

    #[test]
    fn deployment_requires_device_bound_principal() {
        let mut principal = principal();
        principal.device_id = None;

        assert_eq!(
            authorize_deployment_principal(&principal),
            Err(PolicyError::MissingDeviceIdentity)
        );
    }

    #[test]
    fn docs_must_match_activated_route_catalog() {
        let request = DeployRequest::canonical(
            DeploySource::LocalFolder {
                path: PathBuf::from("/work/app"),
            },
            GIT_SHA,
        );
        let mut plan = plan(false);
        plan.docs = Some(DocsArtifactPlan {
            api_docs_revision: GIT_SHA.to_string(),
            publication_mode: "consumer_owned".to_string(),
            semantic_contract_sha256: SHA256.to_string(),
            route_catalog_sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string(),
            output_dir: PathBuf::from("/tmp/docs"),
        });

        assert_eq!(
            validate_deployment_plan(&request, 3, &plan),
            Err(PolicyError::DocsRouteCatalogMismatch)
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
        let state = DesiredState {
            product_id: "scintilla".to_string(),
            generation: 2,
            route_authority: RouteAuthority::Erlang,
            routes: vec![],
            services: vec![],
            labels: BTreeMap::new(),
        };

        assert_eq!(
            execute_transition(&policy(), &TestDaemonAdapter, Transition::Reload, &state),
            Ok(())
        );
    }

    struct TransactionAdapter {
        stages: Mutex<Vec<&'static str>>,
        fail_health: bool,
    }

    impl TransactionAdapter {
        fn new(fail_health: bool) -> Self {
            return Self {
                stages: Mutex::new(vec![]),
                fail_health,
            };
        }

        fn push(&self, stage: &'static str) {
            self.stages.lock().expect("stage lock").push(stage);
        }
    }

    impl ProductDeploymentAdapter for TransactionAdapter {
        fn product_id(&self) -> &str {
            return "scintilla";
        }

        fn plan_deployment(&self, _request: &DeployRequest, _generation: u64) -> Result<DeploymentPlan, String> {
            self.push("plan");
            return Ok(plan(false));
        }

        fn stage_deployment(&self, _plan: &DeploymentPlan) -> Result<(), String> {
            self.push("stage");
            return Ok(());
        }

        fn health_check_deployment(&self, _plan: &DeploymentPlan) -> Result<(), String> {
            self.push("health");

            if self.fail_health {
                return Err("unhealthy".to_string());
            }

            return Ok(());
        }

        fn activate_deployment(&self, _plan: &DeploymentPlan) -> Result<(), String> {
            self.push("activate");
            return Ok(());
        }

        fn drain_previous_generation(&self, _plan: &DeploymentPlan) -> Result<(), String> {
            self.push("drain");
            return Ok(());
        }

        fn commit_deployment(&self, _plan: &DeploymentPlan) -> Result<(), String> {
            self.push("commit");
            return Ok(());
        }

        fn rollback_deployment(&self, _plan: &DeploymentPlan) -> Result<(), String> {
            self.push("rollback");
            return Ok(());
        }
    }

    #[test]
    fn shared_daemon_owns_transaction_order() {
        let adapter = TransactionAdapter::new(false);
        let result = execute_deployment(
            &policy(),
            &principal(),
            &adapter,
            &request_without_docs(),
            3,
        );

        assert!(result.is_ok());
        assert_eq!(
            *adapter.stages.lock().expect("stage lock"),
            vec!["plan", "stage", "health", "activate", "drain", "commit"]
        );
    }

    #[test]
    fn failed_health_check_rolls_back_before_activation() {
        let adapter = TransactionAdapter::new(true);
        let result = execute_deployment(
            &policy(),
            &principal(),
            &adapter,
            &request_without_docs(),
            3,
        );

        assert!(matches!(result, Err(PolicyError::DeploymentHealthCheck(_))));
        assert_eq!(
            *adapter.stages.lock().expect("stage lock"),
            vec!["plan", "stage", "health", "rollback"]
        );
    }
}
