# Zed infrastructure oracle contract

Sibling infra validation must be revision-locked and reproducible.

- Pin the exact `zed-infra` PR/head SHA under test.
- For private source, pin copied files by Git blob SHA and verify their bytes before execution.
- Run Terraform formatting, backend-free initialization, and validation for every environment root.
- Never apply production infrastructure from the test organization.
- Treat generated `.terraform/` directories as runtime artifacts; reject them only when Git-tracked.
- Reject committed `*.tfstate` and provider-native source duplicated under `environments/`.

Cross-dependencies resolved through zed-pkg may participate in tests, but dependency movement must not silently change the infra revision being certified. Lock both the infra source identity and any external contract/tool revision that materially affects the result.
