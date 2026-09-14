# Infrastructure dependency fan-out contract

A shared module or package change must invalidate every consuming infrastructure test that can observe it.

## Fan-out rules

- A change under `modules/cloudflare/` reruns all Cloudflare-consuming environment roots and Worker/Durable Object contract checks.
- A change under `modules/supabase/` reruns Supabase root/config validation plus migration admission tests that depend on that project.
- A change under `modules/neon/` reruns Neon project-root/config validation plus database health/admission checks.
- A zed-pkg dependency update used by infrastructure tooling reruns the same consumer set and records the exact package/tool revision.
- An `environments/<name>/`-only change may scope to that environment when no shared module changed.

Path filtering is an optimization, never permission to miss a consumer. If dependency ownership cannot be resolved deterministically, fail closed and run the broader infra suite.
