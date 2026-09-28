use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::net::IpAddr;
use thiserror::Error;

pub const LOCAL_CONTROL_PROTOCOL: &str = "ores.desktop.local-control/v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteAuthority {
    Erlang,
    Rust,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteTarget {
    pub host: IpAddr,
    pub port: u16,
}

impl RouteTarget {
    pub fn is_loopback(&self) -> bool {
        return self.host.is_loopback();
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteSpec {
    pub route_id: String,
    pub host: String,
    pub path_prefix: String,
    pub target: RouteTarget,
    pub public: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceSpec {
    pub service_id: String,
    pub revision: String,
    pub digest: String,
    pub command_id: String,
    pub health_endpoint: Option<RouteTarget>,
    pub hot_reloadable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesiredState {
    pub product_id: String,
    pub generation: u64,
    pub route_authority: RouteAuthority,
    pub routes: Vec<RouteSpec>,
    pub services: Vec<ServiceSpec>,
    pub labels: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteChange {
    Add(RouteSpec),
    Replace(RouteSpec),
    Remove { route_id: String },
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("product_id must not be empty")]
    EmptyProductId,
    #[error("generation must be non-zero")]
    ZeroGeneration,
    #[error("route_id, host, and path_prefix must not be empty: {0}")]
    InvalidRoute(String),
    #[error("duplicate route_id: {0}")]
    DuplicateRoute(String),
    #[error("local route target must be loopback with a non-zero port: {0}")]
    InvalidRouteTarget(String),
    #[error("service_id and command_id must not be empty: {0}")]
    InvalidService(String),
    #[error("duplicate service_id: {0}")]
    DuplicateService(String),
    #[error("service revision must be exact and non-empty: {0}")]
    MissingRevision(String),
    #[error("service digest must be a sha256 digest: {0}")]
    InvalidServiceDigest(String),
    #[error("service health endpoint must be loopback with a non-zero port: {0}")]
    InvalidHealthEndpoint(String),
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AdapterError {
    #[error("adapter product_id {adapter_product_id} does not match desired-state product_id {state_product_id}")]
    ProductIdMismatch {
        adapter_product_id: String,
        state_product_id: String,
    },
    #[error("shared desired-state validation failed: {0}")]
    SharedValidation(ValidationError),
    #[error("product desired-state validation failed: {0}")]
    ProductValidation(String),
}

pub trait DesktopInfraAdapter {
    fn product_id(&self) -> &str;
    fn desired_state(&self) -> DesiredState;

    fn validate_product_state(&self, _state: &DesiredState) -> Result<(), String> {
        return Ok(());
    }
}

pub fn validate_desired_state(state: &DesiredState) -> Result<(), ValidationError> {
    if state.product_id.trim().is_empty() {
        return Err(ValidationError::EmptyProductId);
    }

    if state.generation == 0 {
        return Err(ValidationError::ZeroGeneration);
    }

    let mut route_ids = BTreeSet::new();

    for route in &state.routes {
        if route.route_id.trim().is_empty()
            || route.host.trim().is_empty()
            || route.path_prefix.trim().is_empty()
            || !route.path_prefix.starts_with('/')
        {
            return Err(ValidationError::InvalidRoute(route.route_id.clone()));
        }

        if !route_ids.insert(route.route_id.clone()) {
            return Err(ValidationError::DuplicateRoute(route.route_id.clone()));
        }

        if !route.target.is_loopback() || route.target.port == 0 {
            return Err(ValidationError::InvalidRouteTarget(route.route_id.clone()));
        }
    }

    let mut service_ids = BTreeSet::new();

    for service in &state.services {
        if service.service_id.trim().is_empty() || service.command_id.trim().is_empty() {
            return Err(ValidationError::InvalidService(service.service_id.clone()));
        }

        if !service_ids.insert(service.service_id.clone()) {
            return Err(ValidationError::DuplicateService(service.service_id.clone()));
        }

        if service.revision.trim().is_empty()
            || matches!(service.revision.as_str(), "latest" | "main" | "master")
        {
            return Err(ValidationError::MissingRevision(service.service_id.clone()));
        }

        if !is_sha256(&service.digest) {
            return Err(ValidationError::InvalidServiceDigest(service.service_id.clone()));
        }

        if let Some(endpoint) = &service.health_endpoint {
            if !endpoint.is_loopback() || endpoint.port == 0 {
                return Err(ValidationError::InvalidHealthEndpoint(service.service_id.clone()));
            }
        }
    }

    return Ok(());
}

fn is_sha256(value: &str) -> bool {
    return value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit());
}

pub fn desired_state_from_adapter<A: DesktopInfraAdapter>(adapter: &A) -> Result<DesiredState, AdapterError> {
    let state = adapter.desired_state();
    let adapter_product_id = adapter.product_id();

    if state.product_id != adapter_product_id {
        return Err(AdapterError::ProductIdMismatch {
            adapter_product_id: adapter_product_id.to_string(),
            state_product_id: state.product_id,
        });
    }

    validate_desired_state(&state).map_err(AdapterError::SharedValidation)?;
    adapter
        .validate_product_state(&state)
        .map_err(AdapterError::ProductValidation)?;

    return Ok(state);
}

pub fn diff_routes(current: &[RouteSpec], desired: &[RouteSpec]) -> Vec<RouteChange> {
    let current_by_id = current
        .iter()
        .map(|route| (route.route_id.as_str(), route))
        .collect::<BTreeMap<_, _>>();
    let desired_by_id = desired
        .iter()
        .map(|route| (route.route_id.as_str(), route))
        .collect::<BTreeMap<_, _>>();

    let mut changes = Vec::new();

    for (route_id, route) in &desired_by_id {
        match current_by_id.get(route_id) {
            None => {
                changes.push(RouteChange::Add((**route).clone()));
            }
            Some(existing) if **existing != **route => {
                changes.push(RouteChange::Replace((**route).clone()));
            }
            Some(_) => {}
        }
    }

    for route_id in current_by_id.keys() {
        if !desired_by_id.contains_key(route_id) {
            changes.push(RouteChange::Remove {
                route_id: (*route_id).to_string(),
            });
        }
    }

    return changes;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    const SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn route(route_id: &str, port: u16) -> RouteSpec {
        return RouteSpec {
            route_id: route_id.to_string(),
            host: "example.local".to_string(),
            path_prefix: "/".to_string(),
            target: RouteTarget {
                host: IpAddr::V4(Ipv4Addr::LOCALHOST),
                port,
            },
            public: false,
        };
    }

    #[test]
    fn route_diff_is_deterministic() {
        let current = vec![route("a", 8000), route("b", 8001)];
        let desired = vec![route("a", 9000), route("c", 8002)];
        let changes = diff_routes(&current, &desired);

        assert_eq!(changes.len(), 3);
        assert!(matches!(&changes[0], RouteChange::Replace(spec) if spec.route_id == "a"));
        assert!(matches!(&changes[1], RouteChange::Add(spec) if spec.route_id == "c"));
        assert!(matches!(&changes[2], RouteChange::Remove { route_id } if route_id == "b"));
    }

    #[test]
    fn public_route_still_must_target_loopback() {
        let state = DesiredState {
            product_id: "scintilla".to_string(),
            generation: 1,
            route_authority: RouteAuthority::Erlang,
            routes: vec![RouteSpec {
                route_id: "bad".to_string(),
                host: "public.example".to_string(),
                path_prefix: "/".to_string(),
                target: RouteTarget {
                    host: "192.0.2.10".parse().expect("test address"),
                    port: 8080,
                },
                public: true,
            }],
            services: vec![],
            labels: BTreeMap::new(),
        };

        assert!(matches!(
            validate_desired_state(&state),
            Err(ValidationError::InvalidRouteTarget(route_id)) if route_id == "bad"
        ));
    }

    #[test]
    fn missing_service_digest_is_rejected() {
        let state = DesiredState {
            product_id: "scintilla".to_string(),
            generation: 1,
            route_authority: RouteAuthority::Erlang,
            routes: vec![],
            services: vec![ServiceSpec {
                service_id: "ingress".to_string(),
                revision: "v1".to_string(),
                digest: "not-a-digest".to_string(),
                command_id: "ingress".to_string(),
                health_endpoint: None,
                hot_reloadable: true,
            }],
            labels: BTreeMap::new(),
        };

        assert!(matches!(
            validate_desired_state(&state),
            Err(ValidationError::InvalidServiceDigest(service_id)) if service_id == "ingress"
        ));
    }

    struct TestAdapter;

    impl DesktopInfraAdapter for TestAdapter {
        fn product_id(&self) -> &str {
            return "wasmx";
        }

        fn desired_state(&self) -> DesiredState {
            return DesiredState {
                product_id: "wasmx".to_string(),
                generation: 7,
                route_authority: RouteAuthority::Erlang,
                routes: vec![],
                services: vec![ServiceSpec {
                    service_id: "router".to_string(),
                    revision: "v1".to_string(),
                    digest: SHA256.to_string(),
                    command_id: "router".to_string(),
                    health_endpoint: None,
                    hot_reloadable: true,
                }],
                labels: BTreeMap::new(),
            };
        }
    }

    #[test]
    fn thin_adapter_can_delegate_immediately() {
        let state = desired_state_from_adapter(&TestAdapter).expect("adapter state should validate");

        assert_eq!(state.product_id, "wasmx");
        assert_eq!(state.generation, 7);
    }
}
