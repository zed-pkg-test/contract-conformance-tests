# ORES Common Desktop Infra hardening certification fixture

Source repository: `ORESoftware/ores-common-desktop-infra`

Source pull request: `#6`

Source head tested: `b63e732707e4c7bbd205ed2a5dab71469158f35d`

This fixture mirrors the executable/validation surface of that source head for external GitHub Actions certification in a `*-test` organization because the private source repository has historically failed to admit GitHub-hosted runners.

Certification covers:

- Rust workspace: desired-state validation, immutable deploy admission, transactional daemon lifecycle and desktop-app bindings;
- Erlang: atomic route-generation publication and hot-upgrade helpers;
- Terraform: infra, CLI and daemon modules;
- Flutter/Dart: local origin, relay client, background bridge and keepalive policy;
- Android: foreground-service restart recovery, repair worker, keepalive nudge worker and Flutter plugin;
- iOS: plugin compilation plus host-app BackgroundTasks/APNs integration and keepalive notifications.
