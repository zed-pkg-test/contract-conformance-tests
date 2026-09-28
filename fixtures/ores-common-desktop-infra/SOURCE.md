# ORES Common Desktop Infra PR 1 certification fixture

Source repository: `ORESoftware/ores-common-desktop-infra`

Source pull request: `#1`

Source head tested: `7650bf7bb0c25d7f3c3a337a4970d639e8657429`

This fixture mirrors the executable/validation surface of that source head for external GitHub Actions certification in a `*-test` organization because the private source repository was not receiving GitHub-hosted runners. Documentation-only files are intentionally omitted from the fixture.

Certification covers:

- Rust workspace: infra, CLI/deploy contract, daemon/deployment policy, desktop app bindings;
- Erlang: route table, product adapters, daemon supervisor and hot-upgrade helpers;
- Terraform: infra, CLI and daemon modules;
- Flutter/Dart: single-origin host, Cloudflare relay client, background bridge and keepalive policy;
- Android: native foreground service, repair worker, 3–5/day keepalive nudge worker and Flutter plugin;
- iOS: Flutter plugin, BGTaskScheduler wake-and-drain and 3–5/day notification prompts.
