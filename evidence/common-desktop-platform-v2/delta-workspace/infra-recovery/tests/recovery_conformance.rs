#![allow(clippy::needless_return)]

use ores_common_desktop_infra_recovery_proof::generation::{
    DeploymentJournalEntry, GenerationError, GenerationIdentity, OperationStage, RecoveryAction,
};

fn identity(generation: u64, byte: char) -> GenerationIdentity {
    return GenerationIdentity::new(generation, byte.to_string().repeat(64))
        .expect("test identity should be valid");
}

fn journal(stage: OperationStage) -> DeploymentJournalEntry {
    return DeploymentJournalEntry {
        operation_id: "deploy-42".to_string(),
        target_identity: identity(42, 'b'),
        previous_identity: Some(identity(41, 'a')),
        stage,
    };
}

#[test]
fn pre_activation_recovery_is_fenced_by_the_complete_durable_identity() {
    let staged = journal(OperationStage::Staged);
    assert_eq!(
        staged
            .recovery_action(&identity(41, 'a'))
            .expect("matching previous identity should be safe"),
        RecoveryAction::Noop
    );

    let health_checked = journal(OperationStage::HealthChecked);
    assert_eq!(
        health_checked
            .recovery_action(&identity(41, 'a'))
            .expect("matching previous identity may resume activation"),
        RecoveryAction::ResumeActivation {
            identity: identity(42, 'b')
        }
    );
}

#[test]
fn restart_never_double_activates_a_target_that_is_already_visible() {
    let health_checked = journal(OperationStage::HealthChecked);

    assert_eq!(
        health_checked
            .recovery_action(&identity(42, 'b'))
            .expect("visible target should recover conservatively"),
        RecoveryAction::RollBackTo {
            identity: identity(41, 'a')
        }
    );
}

#[test]
fn stale_recovery_journal_cannot_clobber_a_newer_deployment() {
    for stage in [
        OperationStage::Prepared,
        OperationStage::Validated,
        OperationStage::Staged,
        OperationStage::HealthChecked,
        OperationStage::Activated,
        OperationStage::Draining,
        OperationStage::Committed,
        OperationStage::RollingBack,
        OperationStage::RolledBack,
    ] {
        let entry = journal(stage.clone());
        assert!(matches!(
            entry.recovery_action(&identity(43, 'd')),
            Err(GenerationError::RecoveryStateMismatch {
                active_identity,
                ..
            }) if active_identity == identity(43, 'd')
        ));
    }
}

#[test]
fn same_generation_with_different_digest_is_never_considered_the_same_deployment() {
    for stage in [
        OperationStage::Prepared,
        OperationStage::Validated,
        OperationStage::Staged,
        OperationStage::HealthChecked,
        OperationStage::Activated,
        OperationStage::Draining,
        OperationStage::Committed,
        OperationStage::RollingBack,
        OperationStage::RolledBack,
    ] {
        let entry = journal(stage);
        assert!(matches!(
            entry.recovery_action(&identity(42, 'c')),
            Err(GenerationError::RecoveryStateMismatch { .. })
        ));
    }
}

#[test]
fn post_activation_recovery_restores_previous_only_when_exact_target_is_still_active() {
    for stage in [
        OperationStage::Activated,
        OperationStage::Draining,
        OperationStage::RollingBack,
    ] {
        let entry = journal(stage);
        assert_eq!(
            entry
                .recovery_action(&identity(42, 'b'))
                .expect("active target should restore previous identity"),
            RecoveryAction::RollBackTo {
                identity: identity(41, 'a')
            }
        );
        assert_eq!(
            entry
                .recovery_action(&identity(41, 'a'))
                .expect("already-restored previous identity should be idempotent"),
            RecoveryAction::Noop
        );
    }
}

#[test]
fn committed_and_rolled_back_terminal_states_are_idempotent_but_fail_closed_on_drift() {
    let committed = journal(OperationStage::Committed);
    assert_eq!(
        committed
            .recovery_action(&identity(42, 'b'))
            .expect("committed target should remain active"),
        RecoveryAction::Noop
    );
    assert!(matches!(
        committed.recovery_action(&identity(41, 'a')),
        Err(GenerationError::RecoveryStateMismatch { .. })
    ));

    let rolled_back = journal(OperationStage::RolledBack);
    assert_eq!(
        rolled_back
            .recovery_action(&identity(41, 'a'))
            .expect("rolled-back previous identity should remain active"),
        RecoveryAction::Noop
    );
    assert!(matches!(
        rolled_back.recovery_action(&identity(42, 'b')),
        Err(GenerationError::RecoveryStateMismatch { .. })
    ));
}

#[test]
fn malformed_recovery_journal_never_reaches_a_mutating_action() {
    let mut blank = journal(OperationStage::HealthChecked);
    blank.operation_id.clear();
    assert_eq!(blank.validate(), Err(GenerationError::InvalidOperationId));

    let mut whitespace = journal(OperationStage::HealthChecked);
    whitespace.operation_id = "deploy 42".to_string();
    assert_eq!(
        whitespace.validate(),
        Err(GenerationError::InvalidOperationId)
    );

    let mut non_monotonic = journal(OperationStage::Activated);
    non_monotonic.previous_identity = Some(identity(42, 'a'));
    assert_eq!(
        non_monotonic.validate(),
        Err(GenerationError::NonMonotonicJournal)
    );

    let mut missing_previous = journal(OperationStage::Activated);
    missing_previous.previous_identity = None;
    assert!(matches!(
        missing_previous.recovery_action(&identity(42, 'b')),
        Err(GenerationError::MissingPreviousGeneration {
            stage: OperationStage::Activated
        })
    ));
}
