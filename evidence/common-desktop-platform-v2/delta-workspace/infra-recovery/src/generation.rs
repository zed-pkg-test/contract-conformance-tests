use ores_runtime_generation::ActiveGenerationIdentity;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenerationIdentity {
    pub generation: u64,
    pub generation_sha256: String,
}

impl GenerationIdentity {
    pub fn new(
        generation: u64,
        generation_sha256: impl Into<String>,
    ) -> Result<Self, GenerationError> {
        let identity = Self {
            generation,
            generation_sha256: generation_sha256.into(),
        };
        identity.validate()?;

        return Ok(identity);
    }

    pub fn validate(&self) -> Result<(), GenerationError> {
        if self.generation == 0 {
            return Err(GenerationError::ZeroGeneration);
        }

        if !is_canonical_sha256(&self.generation_sha256) {
            return Err(GenerationError::InvalidGenerationDigest {
                generation: self.generation,
            });
        }

        return Ok(());
    }
}

impl From<&ActiveGenerationIdentity> for GenerationIdentity {
    fn from(identity: &ActiveGenerationIdentity) -> Self {
        return Self {
            generation: identity.generation,
            generation_sha256: identity.generation_sha256.clone(),
        };
    }
}

impl From<&GenerationIdentity> for ActiveGenerationIdentity {
    fn from(identity: &GenerationIdentity) -> Self {
        return Self {
            generation: identity.generation,
            generation_sha256: identity.generation_sha256.clone(),
        };
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenerationState {
    pub desired_identity: GenerationIdentity,
    pub staged_identity: Option<GenerationIdentity>,
    pub active_identity: GenerationIdentity,
    pub previous_identity: Option<GenerationIdentity>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationStage {
    Prepared,
    Validated,
    Staged,
    HealthChecked,
    Activated,
    Draining,
    Committed,
    RollingBack,
    RolledBack,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeploymentJournalEntry {
    pub operation_id: String,
    pub target_identity: GenerationIdentity,
    pub previous_identity: Option<GenerationIdentity>,
    pub stage: OperationStage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecoveryAction {
    Noop,
    ResumeActivation { identity: GenerationIdentity },
    RollBackTo { identity: GenerationIdentity },
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GenerationError {
    #[error("generation must be non-zero")]
    ZeroGeneration,
    #[error("generation {generation} digest must be lower-case 64-character SHA-256")]
    InvalidGenerationDigest { generation: u64 },
    #[error("staged generation must be newer than active generation")]
    NonMonotonicStage,
    #[error("journal target generation must be newer than its previous generation")]
    NonMonotonicJournal,
    #[error("activation requires the staged generation")]
    MissingStagedGeneration,
    #[error("rollback requires a previous generation")]
    MissingRollbackGeneration,
    #[error("recovery at stage {stage:?} requires a previous generation")]
    MissingPreviousGeneration { stage: OperationStage },
    #[error("operation_id must contain 1..=128 visible ASCII characters")]
    InvalidOperationId,
    #[error(
        "recovery journal does not match durable active identity: stage={stage:?}, active={active_identity:?}, target={target_identity:?}, previous={previous_identity:?}"
    )]
    RecoveryStateMismatch {
        stage: OperationStage,
        active_identity: GenerationIdentity,
        target_identity: GenerationIdentity,
        previous_identity: Option<GenerationIdentity>,
    },
}

impl GenerationState {
    pub fn new(active_identity: GenerationIdentity) -> Result<Self, GenerationError> {
        active_identity.validate()?;

        return Ok(Self {
            desired_identity: active_identity.clone(),
            staged_identity: None,
            active_identity,
            previous_identity: None,
        });
    }

    pub fn stage(&mut self, identity: GenerationIdentity) -> Result<(), GenerationError> {
        identity.validate()?;

        if identity.generation <= self.active_identity.generation {
            return Err(GenerationError::NonMonotonicStage);
        }

        self.desired_identity = identity.clone();
        self.staged_identity = Some(identity);

        return Ok(());
    }

    pub fn activate_staged(&mut self) -> Result<(), GenerationError> {
        let Some(staged_identity) = self.staged_identity.take() else {
            return Err(GenerationError::MissingStagedGeneration);
        };

        self.previous_identity = Some(self.active_identity.clone());
        self.active_identity = staged_identity;

        return Ok(());
    }

    pub fn commit(&mut self) {
        self.desired_identity = self.active_identity.clone();
        self.previous_identity = None;
    }

    pub fn roll_back(&mut self) -> Result<(), GenerationError> {
        let Some(previous_identity) = self.previous_identity.take() else {
            return Err(GenerationError::MissingRollbackGeneration);
        };

        self.desired_identity = previous_identity.clone();
        self.active_identity = previous_identity;
        self.staged_identity = None;

        return Ok(());
    }
}

impl DeploymentJournalEntry {
    pub fn validate(&self) -> Result<(), GenerationError> {
        if self.operation_id.is_empty()
            || self.operation_id.len() > 128
            || !self
                .operation_id
                .bytes()
                .all(|byte| matches!(byte, b'!'..=b'~'))
        {
            return Err(GenerationError::InvalidOperationId);
        }

        self.target_identity.validate()?;

        if let Some(previous_identity) = self.previous_identity.as_ref() {
            previous_identity.validate()?;

            if previous_identity.generation >= self.target_identity.generation {
                return Err(GenerationError::NonMonotonicJournal);
            }
        }

        return Ok(());
    }

    pub fn recovery_action(
        &self,
        actual_active_identity: &GenerationIdentity,
    ) -> Result<RecoveryAction, GenerationError> {
        self.validate()?;
        actual_active_identity.validate()?;

        match self.stage {
            OperationStage::Prepared | OperationStage::Validated | OperationStage::Staged => {
                return self.expect_previous_or_fail(actual_active_identity, RecoveryAction::Noop);
            }
            OperationStage::HealthChecked => {
                let previous_identity = self.previous_for_recovery()?;

                if actual_active_identity == previous_identity {
                    return Ok(RecoveryAction::ResumeActivation {
                        identity: self.target_identity.clone(),
                    });
                }

                if actual_active_identity == &self.target_identity {
                    return Ok(RecoveryAction::RollBackTo {
                        identity: previous_identity.clone(),
                    });
                }

                return Err(self.recovery_state_mismatch(actual_active_identity));
            }
            OperationStage::Activated | OperationStage::Draining | OperationStage::RollingBack => {
                let previous_identity = self.previous_for_recovery()?;

                if actual_active_identity == &self.target_identity {
                    return Ok(RecoveryAction::RollBackTo {
                        identity: previous_identity.clone(),
                    });
                }

                if actual_active_identity == previous_identity {
                    return Ok(RecoveryAction::Noop);
                }

                return Err(self.recovery_state_mismatch(actual_active_identity));
            }
            OperationStage::Committed => {
                if actual_active_identity == &self.target_identity {
                    return Ok(RecoveryAction::Noop);
                }

                return Err(self.recovery_state_mismatch(actual_active_identity));
            }
            OperationStage::RolledBack => {
                let previous_identity = self.previous_for_recovery()?;

                if actual_active_identity == previous_identity {
                    return Ok(RecoveryAction::Noop);
                }

                return Err(self.recovery_state_mismatch(actual_active_identity));
            }
        }
    }

    pub fn recovery_action_from_runtime_identity(
        &self,
        actual_active_identity: &ActiveGenerationIdentity,
    ) -> Result<RecoveryAction, GenerationError> {
        return self.recovery_action(&GenerationIdentity::from(actual_active_identity));
    }

    fn previous_for_recovery(&self) -> Result<&GenerationIdentity, GenerationError> {
        let Some(previous_identity) = self.previous_identity.as_ref() else {
            return Err(GenerationError::MissingPreviousGeneration {
                stage: self.stage.clone(),
            });
        };

        return Ok(previous_identity);
    }

    fn expect_previous_or_fail(
        &self,
        actual_active_identity: &GenerationIdentity,
        action: RecoveryAction,
    ) -> Result<RecoveryAction, GenerationError> {
        let previous_identity = self.previous_for_recovery()?;

        if actual_active_identity == previous_identity {
            return Ok(action);
        }

        return Err(self.recovery_state_mismatch(actual_active_identity));
    }

    fn recovery_state_mismatch(
        &self,
        actual_active_identity: &GenerationIdentity,
    ) -> GenerationError {
        return GenerationError::RecoveryStateMismatch {
            stage: self.stage.clone(),
            active_identity: actual_active_identity.clone(),
            target_identity: self.target_identity.clone(),
            previous_identity: self.previous_identity.clone(),
        };
    }
}

fn is_canonical_sha256(value: &str) -> bool {
    return value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(generation: u64, byte: char) -> GenerationIdentity {
        return GenerationIdentity::new(generation, byte.to_string().repeat(64))
            .expect("test identity should be valid");
    }

    #[test]
    fn same_generation_with_wrong_digest_fails_closed() {
        let entry = DeploymentJournalEntry {
            operation_id: "deploy-42".to_string(),
            target_identity: identity(42, 'b'),
            previous_identity: Some(identity(41, 'a')),
            stage: OperationStage::Committed,
        };

        assert!(matches!(
            entry.recovery_action(&identity(42, 'c')),
            Err(GenerationError::RecoveryStateMismatch { .. })
        ));
    }
}
