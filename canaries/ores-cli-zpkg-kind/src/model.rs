use std::collections::BTreeMap;

use serde_json::Value;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

impl Severity {
    fn is_issue(self) -> bool {
        !matches!(self, Self::Info)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Finding {
    pub code: String,
    pub severity: Severity,
    pub message: String,
    pub target: Option<String>,
    pub details: BTreeMap<String, Value>,
}

impl Finding {
    pub fn info(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(Severity::Info, code, message)
    }
    pub fn warning(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(Severity::Warning, code, message)
    }
    pub fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(Severity::Error, code, message)
    }
    fn new(severity: Severity, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), severity, message: message.into(), target: None, details: BTreeMap::new() }
    }
    pub fn with_target(mut self, target: impl Into<String>) -> Self {
        self.target = Some(target.into());
        self
    }
    pub fn with_detail(mut self, key: impl Into<String>, value: Value) -> Self {
        self.details.insert(key.into(), value);
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CommandReport {
    pub findings: Vec<Finding>,
    pub metadata: BTreeMap<String, Value>,
}

impl CommandReport {
    pub fn new(_command: impl Into<String>) -> Self {
        Self { findings: Vec::new(), metadata: BTreeMap::new() }
    }
    pub fn push(&mut self, finding: Finding) {
        self.findings.push(finding);
    }
    pub fn insert_metadata(&mut self, key: impl Into<String>, value: Value) {
        self.metadata.insert(key.into(), value);
    }
    pub fn issue_count(&self) -> usize {
        self.findings.iter().filter(|finding| finding.severity.is_issue()).count()
    }
    pub fn finalize(self) -> Self {
        self
    }
}
