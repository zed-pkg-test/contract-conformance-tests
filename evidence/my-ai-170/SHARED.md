# Critical agent instructions:

github.com/oresoftware is the owner/user of 'all our github orgs'; the user 'the1mills' is a secondary github user, the 'oresoftware' user is primary user.

we connect github orgs, linear app projects and github org projects (usually at url ending in projects/1), and slack channels;
so this is a 1:1:1:1 - github org : linear app project : github project : slack channel;

the same 1:1 rule extends to the data/edge/cloud planes — 1:1:1:1:1:1:1:

    github org : neondb org : supabase org : cloudflare domain : gcp project : linear app project : slack channel

Near-term Supabase exception (recorded 2026-09-04, see DEN-3146): Supabase projects are not free
(about $25 per project per month), so we scaffold out ALL the per-org Supabase orgs, but for now
every github org shares the `oresoftware` Supabase org, which holds only a canonical db and an auth db.
Each github org gets its own namespace (schema) inside those two dbs so the federated auth system
(shared-auth) keeps tenants separated. Long-term we migrate to the per-org Supabase model; code must
reach Supabase only through the org's runtime config (`*-lib-core` RuntimeConfig / `.cli-flags.toml`)
so that migration is a config change, never a code change.

the slack workspace is 'oresoftware-workspace.slack.com' and something like this: https://app.slack.com/client/T01B3C83PMK/C01B3C845GD

...And the linear app url is: https://linear.app/denman

Hardening for that mapping, without changing it: the GitHub *login* for
`gh` / the API is **ORESoftware**. github.com/oresoftware is the primary org
owner, not the only org — fiducia-cloud, opto-sync, ecma-d, and the rest are
separate GitHub organizations that ORESoftware owns or administers. `the1mills`
is secondary. When `gh` has more than one account, `gh auth switch --user
ORESoftware` before mutating. Linear workspace is **denman**. Put the Linear
id (`DEN-<n>`) in the branch name and the PR title so the 1:1:1:1 actually
attaches; a mismatch silently files the work against the wrong issue.

## Agent guidelines for local folder `~/codes`

Root of all local checkouts. Each subdirectory (`ores/`, `oresoftware/`, fiducia-cloud/`,
`athlet-o/`, `sonus-auris/`, `quaestor-ledger/`, `canonical-cloud/`,
`daedalus-fab/`, `3FA-app/`, …) is its own GitHub org or project, cloned for
real. Work in the specific repo and follow its own `AGENTS.md`.
~/codes/ores and ~/codes/oresoftware are aliases of each other, arbitrary which folder to use, but they are not symlinks of each other.

### Finding this file from inside a repository

This file is the master. It is reachable two ways, and you should try both before
concluding it is unavailable.

1. `~/codes/AGENTS.md` and the vendor-specific paths beside it (`.claude/CLAUDE.md`,
   `.cursor/.cursorrules`, …) — all symlinks to this file, installed by `./setup.sh`.
   This only helps if you can read above the repository you are working in.
2. `.ores/agents/AGENTS.md` inside each repository under `~/codes` — the same symlink,
   placed *inside* the repo for agents that cannot walk up past the repository root.
   Installed for every repo at once by `./scripts/link-repo-agents.sh`, verified with
   `--check`.

The in-repo link is never committed: it names an absolute path that only resolves on a
machine with `~/codes/oresoftware/my-ai` checked out, so a committed copy would be a broken
link everywhere else and in CI. What each
repository does commit is a short pointer block appended to its own `AGENTS.md`
(`lib/agents-pointer.md`) plus a `.gitignore` entry for `.ores/`. If
`.ores/agents/AGENTS.md` is missing, that is a setup gap on this machine — re-run the
link script; do not treat it as permission to skip these instructions.

If both local paths are missing, fetch the canonical copy:
https://github.com/ORESoftware/my-ai/blob/main/AGENTS.md — `gh api`, HTTPS, or
SSH, same failover as any other GitHub read. Do **not** copy this file into
another repository to "make it available": this file is the single source of truth, and a
copy silently goes stale — link to it, or fetch the canonical URL above.
Do **not** `git add` `.ores/`. A missing pointer block in some other repo's
`AGENTS.md` is a rollout gap (`scripts/link-repo-agents.sh` / the pointer
plan), not a reason to skip these rules.

## Env vars and api tokens

Credentials are runtime inputs, never repository documentation.

- **Do not place live or credential-shaped token literals in this file, AGENTS.md, examples, fixtures, issue/PR bodies, logs, command arguments, or generated receipts.** The repository secret scanner must be able to scan the canonical policy files cleanly.
- Treat any credential copied into source control, chat, an issue, or a transcript as exposed material. Do not reuse it as a fallback credential.
- Resolve credentials in this order:
  1. GitHub: use the `gh` keyring first; `gh auth status` should identify the intended account. Prefer `gh api`, `gh pr`, `gh repo`, or SSH remotes. If raw HTTP is unavoidable, resolve `gh auth token` into an environment variable and never place it in argv.
  2. Non-GitHub shared services: source the canonical local store with `set -a; source ~/.config/claude-loop-jobs/credentials.env; set +a` without echoing values. Treat entries explicitly marked burned/revoked as identification-only.
  3. Per-service repository secrets: use the encrypted `env/enc/*.env.enc` flow through `ores-sops` / the repository's `just` targets.
  If none is available, stop that authenticated operation and request reauthentication rather than falling back to copied credentials.
- Pass credentials only through environment/secret-store boundaries. Mask them before invoking tools that may echo environment values, and never persist resolved secret values in artifacts.
- Tests that need credential-shaped inputs must synthesize canaries at runtime instead of checking representative token strings into Git.
- Revocation or rotation is a human-authorized operation. Removing an exposed literal from Git history or documentation does **not** rotate the underlying credential; record the affected credential class and request rotation separately without reproducing its value.
- Historical references should name only the provider and credential class, for example `GitHub PAT (exposed; rotate)`, never the token itself.

## CLI flags and environment variables

* Every executable CLI, web server, API server, admin web server, and admin API
  server that accepts command-line options must use the canonical
  [flags-2-env](https://github.com/flags-2-env/flags-2-env) parser at its argv
  boundary. This is a required runtime integration, not a documentation hint.
* Put the public command/flag contract in a repository-root
  `.cli-flags.toml`. Commands, option aliases, types, defaults, environment
  keys, help, and precedence must have one authority: that contract.
* Add the runtime's official `flags-2-env` binding, audit the contract before
  startup, parse argv through it, reject unknown options and invalid typed
  values without continuing, then pass an immutable resolved configuration
  inward. Do not call this complete when only the TOML file, generated env
  constants, or a config-audit call exists.
* Clap, argparse, commander, and similar libraries may project already-resolved
  values into application types, but must not remain an independent parser or
  second option schema. Silent fallback to plain environment parsing is not
  allowed: parser/config failures are startup failures.
* Use `flags-2-env` for `.env` precedence too. Avoid adding dotenv-style
  loaders when it already covers the runtime. Credentials remain
  environment/secret-store only; do not expose them as CLI flags because argv
  is visible in process listings and shell history.
* Use [ores-sops](https://github.com/oresoftware/ores-sops) with SOPS, age,
  Just, and Nix for the encrypted environment-file lifecycle.
* Track only encrypted environment files under `env/enc/*.env.enc`. Decrypt
  them to the ignored `env/dec/*.env` runtime directory; never commit plaintext
  files from `env/dec/`.
* Load the small number of centrally managed runtime secrets from the
  [fiducia-cloud](https://github.com/fiducia-cloud) secrets keystore. GitHub
  Actions secrets may be used as a backup delivery path, but encrypted
  `env/enc/*.env.enc` files remain the version-controlled source of truth.


## Overall best practices

Follow [github.com/22-factor-apps](https://github.com/22-factor-apps) and the
[Twenty-Two-Factor site](https://22-factor-apps.github.io) for the general
project and operational best practices used across this workspace.

## Schema, protobuf, typespec, json-schema diesel and ORM's

it's critical that json-schema and typespec defs are at same level -

this is wrong:
TypeSpec → JSON Schema / OpenAPI / Protobuf → wire clients 

it should be this flow:
TypeSpec → sql, Protobuf , grpc → wire clients 

paired with this flow:
JSON Schema / OpenAPI  -> generate interfaces and types in various clients and generate sql -> write clients

Use only configured GitHub and Linear clients or credentials delivered through an approved runtime secret channel. Never store credential values in this policy; do not revoke or rotate credentials without explicit human authorization.



## External platform usage: Cloudflare and GitHub Pages

For every GitHub organization, pair the organization with an apex domain that
we own. In this convention, each asterisk is a placeholder: the GitHub
organization name replaces the asterisk in the GitHub Pages URL, while the two
domain asterisks represent the owned domain name and its public suffix instead
of hard-coding `.com`, `.dev`, `.net`, `.co`, or another suffix.

Every organization must have an Astro marketing site at
`https://*.github.io/`. Create the organization-site repository as
`*.github.io`, replacing the asterisk with the GitHub organization name. Use
Astro, not Jekyll or Hugo. Give the site separate pages and folders for its
major sections, link those sections from the root page, and use strong shared
headers and footers. Prefer a sticky header, and make the full site highly
responsive across mobile, tablet, and desktop viewports.

The marketing site must provide clear links for users and organizations to
reach their respective login applications. Cloudflare is the public DNS and
proxy layer for the owned domain, with this canonical subdomain contract:

~~~text
auth.*.* ## the auth subdomain is auth proxy for github.com/shared-auth servers
org.*.* ## the org subdomain is for org level logins/app - points to web server
user.*.* ## user subdomain is for user app - user login not org login - points to web server
api.*.* ## the api subdomain points to our api server
admin.*.* ## the admin subdomain points to admin web server
api-admin.*.* ## the api-admin subdomain points to admin api server
~~~

Record the concrete organization, owned domain, GitHub Pages repository, and
Cloudflare routing implementation in the organization's corresponding Linear
project as part of the 1:1:1:1:1:1:1 organization/data/edge/cloud/project/channel convention.


## Credentials and durable backups for code

Live credentials do not belong in this repository or in any `AGENTS.md`. Never
commit, paste, print, log, upload, or place a GitHub PAT, Linear token,
Cloudflare API token, R2 access key, R2 secret key, session cookie, private key,
or decrypted environment value in Git, a remote URL, shell history, a command
argument, a PR, an issue, Linear, Slack, chat, or R2 object metadata.

If a credential appears in any of those locations, treat it as exposed: do not
reuse it or copy it into another system. Report the exposure and ask the owner
to rotate it. Do not revoke, rotate, or delete credentials without explicit
human authorization.

Use credentials in this order:

1. Existing local authentication from the OS keychain or an approved credential
   helper: `gh` keyring auth or SSH for GitHub, the configured Linear client for
   Linear, and `wrangler` login or a scoped secret manager entry for Cloudflare.
2. A task-specific, least-privilege credential delivered through an approved
   secret channel. It may override the local credential for that process only;
   inject it through the environment and never persist or echo it.
3. Interactive re-authentication by the human owner.

Never use chat history or a repository file as a credential fallback. A token
provided through an approved secret channel can shadow the locally configured
credential for the current task, but its value must remain outside the repo and
outside agent-visible output.

For GitHub, prefer `gh auth token >/dev/null`, `gh api`, and SSH. For Linear,
use the configured client or a secret-manager-backed `LINEAR_API_KEY`. For
Cloudflare/R2, use one of these non-overlapping credential sets:

- Cloudflare REST/API operations: a least-privilege `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`.
- R2 S3-compatible operations: bucket-scoped `AWS_ACCESS_KEY_ID` and
  `AWS_SECRET_ACCESS_KEY`, plus `R2_ENDPOINT_URL` and `R2_BUCKET`.

The S3-compatible endpoint has the form
`https://<account-id>.r2.cloudflarestorage.com`. Keep the account ID and bucket
configuration outside source when the deployment treats them as private. Test
the exact path without printing credentials, for example:

```bash
gh auth token >/dev/null
gh api user --jq .login
aws s3api head-bucket --bucket "$R2_BUCKET" --endpoint-url "$R2_ENDPOINT_URL" >/dev/null
```

Git commits, a pushed branch, and a pull request are the primary durable backup
for code. If every Git publication path is unavailable, R2 may be used as a
last-resort artifact backup after reviewing explicit paths and running the
repository secret scanner. Store artifacts under:

```text
codes/<org>/<repo>/<branch>/<commit-or-utc-timestamp>/
```

Include a manifest with the source repository, branch, base commit, creation
time, included paths, and SHA-256 checksums. Encrypt sensitive-but-allowed
artifacts before upload with a recipient-controlled key. Never upload `.git/`,
ignored files, plaintext `.env` files, credentials, keychains, SSH keys, age
identities, decrypted SOPS data, database dumps containing user data, or an
unreviewed whole-workspace archive. After Git access returns, land the reviewed
source through the normal commit/push/PR flow; an R2 object alone is not a
completed delivery.

## critical 'git merge' and 'git rebase' instructions:
avoid 'git rebase', strongly preferring git merge without rebase; upon any git conflicts, resolve the conflicts semantically - do not merely pick sides nor do shallow analysis: instead, always do deep work given total context and at least 15 commits of git history to figure out how to resolve conflicts conceptually and merge the code not merely picking sides. Avoid 'git rebase', avoid 'git stash', never 'git reset' without human user permission. No destructive ops without human user permission or explicit pre-authorization. in other words, resolve git conflicts conceptually using deep context evalution from git history and other gh repos in same github org and similar gihtub orgs as we have many analogous repos across gh orgs, usually matching by repo name.

The reasoning behind those rules, and the procedures they imply, are in
`my-ai/original-agents.md` — read it before any non-trivial git operation:

* **Syncing** is two-way. A clean local tree is not "synced"; you are done only when local and remote hold the same commits. Commit first, then `fetch --all --prune`, then `pull`/`merge`, then `push`. Do not wait for the user to say "commit" or "push" once the change is verified: commit, merge the remote default branch, push the branch, and open or update the pull request. Ready work must not remain only on the local disk.
* **Stashes** are invisible: they live in no remote and do not appear in `git status` or ahead/behind counts, so a repo holding thousands of lines of stashed work reports a clean tree to you and to every tool that scans for unlanded work. Use a `wip/<what-it-is>` scratch branch instead, and stage explicit paths rather than `-A`. If you find someone else's stash, make it reachable with `git branch rescue/<id> refs/stash` — never pop it.
* **Worktrees** require explicit human instruction; concurrent agent activity is not permission. `main` is production, `dev` is integration.
* **`~/codes/dd` is out of scope** for all automated tooling and agent tasks.
* **Stage explicit paths.** Never `git add -A` / `git add -a`: most checkouts
  here carry someone else's WIP or a pending `.gitignore`. `-A` is how you
  commit work that is not yours, plus secrets.
* **"Cannot push to GitHub" is not a merge-rule exception.** Protected
  `main`/`dev` (`hook declined`, `Changes must be made through a pull request`)
  means push a feature branch and open a PR. It does not mean force-push, it
  does not mean rebase onto main, and it does not mean the work stays local.

## critical git push and github instructions

always push the code/commits to github when done commiting - using github mcp server, ssh, gh cli, or a web browser tab/window - but it is not acceptable to just sit on the code locally;

and if no further instructions are given and you have cycles - take next steps, take care of at least 10 tasks from this thread/chat and linear app projects;

make sure to open pull requests, even if just draft PR's, and merge any PR's that ready/tested - resolve any git conflicts semantically/conceptually according to oresoftware/my-ai/AGENTS.md

if github cannot be reached, which should never happen, use cloudflare r2 or google drive or linear app to back-up the commits/artifacts since we don't want them only locally - we need to backup.

## critical: land work without waiting to be asked

Do **not** ask "say if you want those committed and opened as PRs." Do **not**
end a turn holding uncommitted or unpushed implementation behind a question
about whether to land it. We cannot afford that delay. By default, after you
finish a slice of real work:

1. Commit it (explicit paths, never `-A`; never `.env`, PATs, age keys, or other secrets).
2. `fetch --all --prune`, merge upstream if needed, then `push -u`.
3. Open a GitHub pull request. If the work is incomplete, tests are owed, or CI
   may still fail, open it as a **draft**. If it is ready for review, open a
   normal PR. Put the PR URL in the turn summary.
4. Repeat as you go. A draft PR that exists on GitHub is always better than
   finished code that only lives on one laptop.

Asking whether to commit/PR is a failure mode. The human can close, convert, or
reject a draft; they cannot review work that never left the machine. This does
**not** authorize force-push, rebase, stash, reset, or committing onto `main`
unless the human named `main`. Feature work goes on a branch off the latest
remote default branch. Closing that PR still requires the salvage pass below.

The same default applies when the human says "yes commit and open PRs" after an
agent offered to wait: treat that as the standing rule, not a one-off.


we have a k8s cluster on aws on an ec2 machine and a k8s cluster on a hetzner cloud machine - this is stored in vcs at github.com/oresoftware/k8s-cluster and is the primary way we deploy our servers/deployments.

the only thing that's on a different k8s cluster is github.com/fiducia-cloud services - fiducia-node.rs and fiducia-brain.rs which deploy on entirely separate k8s clusters.

## Critical 'git submodule' instructions: how we do app-of-apps

We use git submodules to build "app of apps" superprojects. Two layouts cover
almost everything:

| Superproject | Submodules live in | What they are |
|---|---|---|
| `github.com/*/*-monorepo` | `apps/` | the org's deployable apps |
| `github.com/oresoftware/k8s-cluster` | `remote/deployments/` | every service we deploy to k8s |

`k8s-cluster` also pins libraries and shared code under `remote/submodules/`,
`remote/modules/`, and `remote/libs` — see
[k8s-cluster/SUBMODULES.md](https://github.com/oresoftware/k8s-cluster/blob/main/SUBMODULES.md)
for the full path-to-upstream table and `k8s-cluster/AGENTS.md` ("Submodules are
secondary") for the rules that repo enforces.

### The one rule that matters: a submodule checkout is a SECONDARY copy

The source of truth for a submodule is **its own upstream repo**, never the copy
vendored into the superproject. So:

1. Develop in the upstream repo, or in its standalone `~/codes/<org>/<repo>` clone.
2. Commit, merge, and **push there first**.
3. Only then bump the pointer (the "pin") in the superproject.

Editing files directly inside `apps/<app>` or `remote/deployments/<svc>` is easy
to lose, bypasses that repo's own history, CI, and reviewers, and produces a pin
nobody else can fetch. Don't do it.

A monorepo's `monorepo.config.json` lists which apps belong in `apps/`; treat it
as the manifest of expected submodules.

### After any clone, submodules are EMPTY until you init them

`git clone` does not populate submodules. `apps/` and `remote/deployments/` will
be empty directories, so builds fail and greps silently find nothing. This is the
single most common way an agent misreads one of these repos.

```bash
git submodule update --init              # one-level apps/ or remote/deployments/
git submodule update --init --recursive  # only when a submodule itself nests more
```

Prefer the non-recursive form for `*-monorepo` and `k8s-cluster`; both are
one level deep, and `--recursive` can drag in large third-party trees
(e.g. tree-sitter grammars under forks).

To init/refresh submodules across every checkout under `~/codes` at once:

```bash
python3 ~/codes/codes_audit.py --push --submodules
```

That reports any repo whose submodules are uninitialized or drifted, checks them
out, and never rebases, stashes, resets, or force-pushes.

### Read `git submodule status` before you conclude anything

The first character of each line is the state:

| Flag | Meaning | What to do |
|---|---|---|
| (space) | in sync with the recorded pin | nothing |
| `-` | not initialized — **the directory is empty** | `git submodule update --init` |
| `+` | checked-out commit differs from the recorded pin | see below |
| `U` | merge conflict on the gitlink | resolve semantically, see below |

### `+` pointer drift is NOT a dirty working tree

When a superproject pulls a commit that records a new submodule commit, plain
`git status` reports the submodule path as ` M apps/<app>` — as if a file were
edited. It is not an edit; it is the gitlink pointing somewhere else. Check for
real, uncommitted work with:

```bash
git status --porcelain --ignore-submodules=all   # empty  => no real file edits
git submodule status | grep -E '^[-+U]'         # what is actually out of sync
```

Do not treat drift as "dirty" and skip the repo — that leaves the submodule
permanently stale. Resolve it with `git submodule update --init`, which checks
out the commit the superproject recorded.

Never add `--force` to `git submodule update`. Without it, git refuses to
overwrite uncommitted work inside a submodule; with it, that work is destroyed.

### Push the submodule BEFORE the superproject

If you publish a moved pin while the submodule commit exists only on your
machine, every other clone breaks with:

```
fatal: remote error: upload-pack: not our ref <sha>
```

Correct order, always:

```bash
cd apps/<app> && git push          # 1. publish the submodule commit
cd - && git add apps/<app>
git commit -m "chore: bump <app> pin to <short-sha>"
git push                            # 2. publish the pin
```

`k8s-cluster` enforces this with a `pre-push` guard
(`.githooks/submodule-push-guard.sh`) that refuses a push whose gitlinks are not
reachable on their own remotes. If it blocks you, the guard is right — go push
the submodule. Do not reach for `DD_SKIP_SUBMODULE_PUSH_GUARD=1`.

### Conflicts on a pin follow the semantic merge rules above

A gitlink conflict looks like two SHAs, which makes it tempting to just pick
one. Don't — that silently discards whichever side you drop. Instead:

1. Resolve the underlying conflict **in the source repo** and merge it there.
2. Return to the superproject and pin the resulting merged commit.
3. Confirm the new pin is reachable on the submodule's remote before pushing.

Picking a SHA is exactly the "merely pick sides" failure the git merge section
forbids; the pin is a claim about which code we deploy.

### Don't double-pin the same app

If an app is already pinned through its org's `*-monorepo`, do not also pin that
app directly in `k8s-cluster`. One owner per app, or the two pins drift and it
becomes ambiguous which commit actually ships.

### `.gitmodules` URLs mix SSH and HTTPS

Both `git@github.com:org/repo.git` and `https://github.com/org/repo.git` appear
in our `.gitmodules` files. On a machine with no SSH key, the SSH ones hang on a
host-key prompt or fail auth. Rewrite them for your own git invocations rather
than mutating the user's global config — `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n`
/ `GIT_CONFIG_VALUE_n` are inherited by the child processes git spawns per
submodule:

```bash
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf \
GIT_CONFIG_VALUE_0=git@github.com: \
  git submodule update --init
```

## Critical - we almost always use this pattern:

* github.com/shared-auth for auth 
* github.com/opto-sync for syncing data across devices/boundaries
* github.com/ores-otel for logging and telemetry and observability
* github.com/zed-pkg for package/dependency management - this our holistic homegrown answer to dep mgmt

### zed-pkg manifest + task conventions (verified against zed-cli v0.3.0, 2026-09-04)

* `.zpkg.toml` `[scripts]` accepts ONLY `test`. Every other key (`check`, `deps`, `build`, `lint`, `format`, `validate`, `install`, `publish`, `run`, `start`, `dev`) fails `zed validate` with `unknown manifest field $.scripts.<key>`; a `[tasks]` table in the manifest is rejected the same way.
* Project tasks live in a schema-v2 environment plan at the repo root: `zed-env.toml` (or `zed-env.json`, `.zed/environment.toml`, `.zed/environment.json`), discovered by `zed task` by convention:

```toml
schema = 2

[tasks.deps]
description = "Install exactly what .zpkg.lock pins (fails on any drift)"
run = ["zed install --frozen"]

[tasks.check]
description = "Validate manifest and lock, then run the repository conformance script"
aliases = ["ci"]
run = ["bash scripts/check.sh"]
```

  Supported task fields: `description`, `aliases`, `depends`, `depends_post`, `wait_for`, `run` (list of shell commands), `run_windows`, `dir`, `env` (scalars only), `timeout` (`ms`/`s`/`m`/`h`), `confirm` (requires `--yes`), `hide`, `cache = true` + `sources`/`outputs`. Arguments after `--` are exposed as `ZED_TASK_ARGC` / `ZED_TASK_ARG_<n>` / `ZED_TASK_ARGS_JSON`, never shell-interpolated. Drive with `zed task list | info <task> | graph <task> | run <task> [--dry-run] [--jobs N]`.
* CI runs `zed task list && zed task run check` after installing a checksum-pinned release of `zed` from `https://github.com/zed-pkg/zed-cli/releases/download/<tag>/zed-x86_64-unknown-linux-musl.tar.gz` (verify the `.sha256` sidecar; `zpkg.tech` does not resolve). Current pin: v0.3.0, sha256 `e380240c96242ab3b29e0e9d14c95ba946d086f20f0732e34d0e5cf47513efc7`.
* `[package.repository]` is required. A whole-repository `[targets.repository]` must not set a `name` that differs from the canonical package name (omit `name`).
* 0.3.0 flag spellings: `zed install --install-mode copy` (not `--mode`), `--do-not-write-new-manifest` (alias of the deprecated `--allow-no-manifest`), `--adapter rust|node|go|python|java|dart|none`, `--target <subtree>`.

And important: most of our own runtimes are dart, rust and typescript so at the very least we should support those 3 languages and use json-schema to enforce interfaces/contracts whether internal or external. On backend we usually choose rust, for client either typescript or flutter/dart, but we should never use react/jsx. We can use RxDart and RxJS/RxTS though of course. In other words, internal apis always use dart, typescript or rust. External sdk's, api's and lib's can use other languages, so we can publish sdk's in other languages etc etc;


## Important: almost always we have a sibling test org so for these orgs for example:

github.com/opto-sync we have github.com/opto-sync-test
github.com/fiducia-cloud we have github.com/fiducia-cloud-test
github.com/declarative-migrations we have github.com/declative-migrations-test
github.com/cliptown we have github.com/cliptown-test 

etc etc; use the test org to mimic external testing (end user testing) or to get more gha minutes since we are on budget for github actions.

`declative-migrations-test` is the real sibling org name as created — do not
"correct" it to `declarative-migrations-test` when cloning or opening PRs.

#### note most of our gh orgs should have repos with these names and patterns:

My apologies. By applying the actual repository prefix, the asterisk formatting issue disappears entirely. Here is the raw list with single quotes as requested:

* \*-clients ## has a subdir/folder called clients which should contain 15+ languages for both internal and external sdk's/libs
* \*-sync  ## uses opto-sync
* \*-infra  ## contains infra code for cloudflare workers and k8s manifests etc
* \*-monorepo ## has a dir/folder called apps which has git submodules
* \*-cli  ## rust-based cli interface/tool
* \*-interfaces  ## shared interfaces/types - just types not bodies nor implementations
* \*-web-server.rs ## rust web server using mash (supabase seaorm htmx maud axum) and leptos and dioxus too for islands/pagelets
* \*-api-server.rs ## rust based api server using seaorm
* \*-admin-web-server.rs ## rust-based admin web server (mash/leptos/dioxus) on the admin VPC; super-admins only; no public ingress
* \*-admin-api-server.rs ## rust-based admin JSON API with write access to the admin RDS; product web/api cannot reach that DB
* \*-lib-core ## orm code for seaorm, drizzle, prisma, gorm, grpc stuff etc etc
* \*-orm-core ## opaque SeaORM / migration boundary shared by web, api, and admin servers via zed-pkg
* \*-flutter ## flutter repo for desktop and mobile apps
* \*-desktop-app.rs # rust based desktop app sometimes using FFI to use a different ui layer (but never uses react nor uses webviews)
* \*-e2e # end to end testing repo for tests of all kinds integration, system, e2e, unit tests, etc etc
* \*-daemon.rs ## rust daemon on end-user machines; connects to api server and web server (see ecmad-daemon.rs)
* \*-mcp-server.rs ## rust based mcp server borrowing/inheriting from github.com/oresoftware/\*mcp-server\* base
* \*-sidecar.rs ## rust based sidecar which can borrow/inherit from shared base
* \*-docs ## this repo has a docs folder and contains docs both internal/external and legal docs etc

important note: the asterisk in front of repo names is obviously a wildcard that matches the org name or an abbreviation of the org name


#####  make sure the api and web servers can interact in all these 4 ways, here is design with at least 4 possible options/avenues:
1. web server does direct db query (reads as opposed to writes are pretty safe), so it skips going to api, so make sure web server can use orm just not for migrations
2. web server does stateless http request to api server cluster/group
3. web server has stateful tcp conn to api server cluster/group
4. web server puts a message on NATS/mq and then api server responds totally async etc (so both web server and api server needs nats libraries and webhooks/endpoints to post to (we have nats intermediaries in github.com/oresoftware/k8s-cluster))


## in other words, repos should follow these patterns:

#### for example, with github.com/honeypot-r-us

* github.com/honeypot-r-us/hnpt-web-server.rs  ## rust web server using mash/leptos/dioxus (mash is maud, axum, supabase, seaorm, htmx)
* github.com/honeypot-r-us/hnpt-api-server.rs ## json api server using seaorm for orm
* github.com/honeypot-r-us/hnpt-infra ## put our cloudflare code in here and k8s yaml
* github.com/honeypot-r-us/hnpt-clients  ## in hnpt-clients/clients folder put clients in 15+ languages to support our external sdk/lib
* github.com/honeypot-r-us/hnpt-cli ## cli written in rust, uses flags-2-env and interacts with the deamon and imports hnpt-interfaces and hnpt-clients
* github.com/honeypot-r-us/hnpt-flutter ## flutter for desktop and mobile apps and mobile web
* github.com/honeypot-r-us/hnpt-desktop-app.rs ## rust based desktop app, not to be confused with flutter desktop app
* github.com/honeypot-r-us/hnpt-sync ## wraps opto-sync for web dev purposes with sql-lite and supabase integrations etc
* github.com/honeypot-r-us/hnpt-interfaces ## multi-language types/interfaces but not bodies/implementations
* github.com/honeypot-r-us/hnpt-lib-core ## uses ORM code for postgres and cockroachdb
* github.com/honeypot-r-us/hnpt-monorepo ## monorepo is app of apps where all apps (git submodules) live in apps folder
* also hnpt should have a sidecar, mcp server, etc etc

#### in github.com/ecma-d github org we need these repos, for example

* github.com/ecma-d/ecmad-web-server.rs ## rust web server using mash/leptos/dioxus (mash is maud, axum, supabase, seaorm, htmx)
* github.com/ecma-d/ecmad-daemon.rs ## deamon rust process running on end-user machines, connects with api server and web server
* github.com/ecma-d/ecmad-api-server.rs ## json seaorm web server, imports ecmad-interfaces and ecmad-lib-core
* github.com/ecma-d/ecmad-infra ## put our cloudflare code in here
* github.com/ecma-d/ecmad-monorepo ## monorepo is app of apps where all apps (git submodules) live in apps folder, only k8s-deployable apps go in here, not things like ecmad-infra or ecmad-cli or ecmad-flutter
* github.com/ecma-d/ecmad-clients  in ecmad-clients/clients folder put clients in 15+ languages to support our external sdk/lib
* github.com/ecma-d/ecmad-cli ## cli written in rust, uses flags-2-env and interacts with the deamon
* github.com/ecma-d/ecmad-flutter ## flutter for desktop, mobile web and mobile apps
* github.com/ecma-d/ecmad-desktop-app.rs ## rust based desktop app, not to be confused with flutter desktop app, they compete for attention
* github.com/ecma-d/ecmad-sync ## wraps opto-sync for web dev purposes with sql-lite and supabase integrations etc
* github.com/ecma-d/ecmad-interfaces ## multi-language types/interfaces but not bodies/implementations
* github.com/ecma-d/ecmad-lib-core ## uses ORM code for postgres and cockroachdb, helps with db migrations, main source of truth for db migrations so it can be shared between web server and api server, see github.com/declarative-migrations
* also ecma-d/ecmad should have a sidecar, mcp server, etc etc


## Backend infra

We use github.com/shared-auth for authentication which uses dual auth with supabase. We also use supabase for streaming logs to from github.com/ores-otel;
We use postgres for most persistence, but we can use cockroachdb for distributed database too; redis for caching. and we can use indexeddb (indexed-db) and sql-lite on clients for storage. Cloudflare R2 instead of s3 for most files/artifacts. See github.com/oresoftware/k8s-cluster


## Code style and coding patterns

remember to modularize the rust, typescript and dart - not everything belongs in main.rs, main.ts and main.dart; also follow functional coding principles - fewer side-effects (use pure functions more), more immutability (immutable variables); but for stateful apps like the client or stateful servers like websockets or tcp connections, sometimes classes and oop make more sense than functional programming perse, but we can still adhere to functional programming more than usual. Favor exhaustive pattern matching and use formal methods checking too. Favor composability and re-use , so basically create more utility functions and routines for shared use. You can follow a medium level of D.R.Y. (don't repeat yourself) - in other words you can repeat yourself at medium amount (not too much not too little). Some chaining is totally fine, so either method-chaining (immutable sometimes although with classes can be mutable too for performance), and chaining via the pipe operator is ok in languages like gleamlang.

Functional programming is mostly the following:

+ explicit inputs
+ explicit outputs
+ immutable values
+ pure transformations
+ typed errors
+ explicit state transitions
+ composition
+ effects pushed outward
+ illegal states excluded by types


## Agents reaching GitHub (Cursor, Claude Code, Codex) — more than one way

Cursor agents, Claude Code, and Codex should use the available authenticated GitHub path to
create repos, push commits, open PRs, or call the API. Credentials are **not** shared across
tools unless we wire them. If one path fails, switch to another in this order (or in parallel):

1. `gh` CLI (HTTPS + keyring / PAT)
2. `git` over SSH (`~/.ssh`, `git@github.com:...`)
3. `git` over HTTPS (`https://github.com/...` + PAT / `gh` credential helper)
4. GitHub REST/GraphQL via `curl`/`gh api` (Bearer PAT or `gh auth token`)
5. GitHub MCP stdio server (Cursor / Claude Code / Codex MCP config)
6. Interactive reauthentication or a task-scoped credential delivered through an approved
   secret channel; stop if neither is available

Primary GitHub identity: **ORESoftware** / **oresoftware**. Secondary: **the1mills**. Keep
ORESoftware the active `gh` account when both are logged in.

Do **not** paste PATs into git-tracked MCP configs, repository instructions, chat logs, or commit
messages. Use `gh auth token` or SSH for day-to-day agent work. A credential found in a repository
or chat is exposed evidence that requires rotation, never an authentication fallback. If the
approved paths above are unavailable, stop and request reauthentication or secure delivery.

### Who uses what

| Surface | Typical GitHub path | Config |
| --- | --- | --- |
| Cursor Agent | MCP `user-github` **and** terminal `gh`/`git` | `~/.cursor/mcp.json` + `~/.cursor/github-mcp.sh` |
| Claude Code | terminal `gh`/`git` **and** optional MCP | `~/.claude.json` / project `.mcp.json` |
| Codex | terminal `gh`/`git` (network + sandbox exceptions) **and** optional MCP | Codex MCP / `~/.codex/config.toml` |
| All three | clone/push | `git@github.com:ORESoftware/<repo>.git` or HTTPS remotes |

A green MCP `namespaceStatus: ready` is **not** proof of auth. A successful `gh auth status` is
**not** proof MCP has a token. A working SSH push is **not** proof `gh api` works. Test the path
you are about to use.

### 1. `gh` CLI (preferred for issues, PRs, API, `gh repo create`)

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
gh auth status
gh api user --jq .login          # expect ORESoftware
gh auth token >/dev/null         # keyring token; do not print it into chat
```

If logged out or the wrong account is active:

```bash
gh auth login -h github.com
gh auth switch --user ORESoftware   # when multiple accounts exist
```

Use `gh` for: `pr create`, `pr view`, `issue`, `api`, `repo create`, `release`, checks.
If `gh` is missing from a GUI-spawned agent PATH (common on macOS), call
`/opt/homebrew/bin/gh` or prepend Homebrew as above.

`GH_TOKEN` / `GITHUB_TOKEN` in the environment override keyring. An empty or placeholder
value (`from-env`) will break `gh` the same way it breaks MCP — unset it or replace it
with a real token from `gh auth token`.

### 2. SSH (`git` clone / fetch / push)

```bash
ls -la ~/.ssh
ssh -T git@github.com            # expect a success message for ORESoftware or the1mills
git remote -v                    # prefer git@github.com:ORESoftware/<repo>.git
```

If HTTPS remotes fail but SSH works (or vice versa):

```bash
git remote set-url origin git@github.com:ORESoftware/<repo>.git
# or
git remote set-url origin https://github.com/ORESoftware/<repo>.git
```

Host aliases in `~/.ssh/config` (`Host github.com`, `IdentityFile`, `IdentitiesOnly yes`) are
valid. Agents must use those keys rather than inventing a new identity. Never `git reset` /
force-push without explicit human permission (see merge rules above).

### 3. HTTPS git + PAT / credential helper

HTTPS remotes use a PAT or `gh` as the credential helper, not SSH keys.

```bash
git config --get credential.helper
gh auth setup-git                # so git HTTPS uses the gh keyring
git ls-remote https://github.com/ORESoftware/my-ai.git
```

Fallback: use a PAT resolved at runtime from an approved credential helper as
the HTTPS password; username is the GitHub user (`ORESoftware`), not the email.
Do not write that PAT into `.git/config`, a repo-local remote URL, a command
argument, or this file.

### 4. Direct HTTP API (`curl`, scripts, non-gh tools)

```bash
TOKEN="$(gh auth token)"
curl -sS -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" \
  https://api.github.com/user
```

If `gh` is unavailable, resolve a PAT from an approved credential helper and
pass it through standard input or a process-local environment boundary. GraphQL
is `https://api.github.com/graphql`. This path is how you verify a token even
when MCP is down.

### 5. GitHub MCP (Cursor, Claude Code, Codex)

Stdio server: `@modelcontextprotocol/server-github`. It reads
`GITHUB_PERSONAL_ACCESS_TOKEN`. Cursor, Claude Code, and Codex **do not** automatically
inherit `gh` keyring credentials.

**Broken pattern** (literal placeholder; GitHub returns `Bad credentials`):

```json
"github": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "from-env"
  }
}
```

`from-env` is not interpolated. `namespaceStatus: ready` still happens because the process
started. Tool calls then fail with `MCP error -32603: Authentication Failed: Bad credentials`.
`mcp_auth` on this stdio server does not mint a GitHub PAT.

**Fix for all three agents:** a launcher that copies `gh auth token` into the env the MCP
process actually sees. Do not put a PAT in the JSON.

`~/.cursor/github-mcp.sh` (chmod +x). Reuse this same script from Claude Code and Codex MCP
configs so there is one token source. The launcher **unsets** `GH_TOKEN` /
`GITHUB_TOKEN` when they are empty or `from-env`, because those override
`gh auth token` and make it echo the placeholder:

```zsh
#!/bin/zsh
# Launch the GitHub MCP stdio server with a real PAT.
# Cursor/Claude/Codex do not interpolate the literal placeholder "from-env".
# GH_TOKEN=from-env also makes `gh auth token` echo that placeholder.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.nvm/versions/node/v22.13.0/bin:${PATH}"

placeholder() {
  [[ -z "${1:-}" || "${1}" == "from-env" ]]
}

for var in GITHUB_PERSONAL_ACCESS_TOKEN GH_TOKEN GITHUB_TOKEN; do
  if placeholder "${(P)var-}"; then
    unset "$var"
  fi
done

token="$(gh auth token --hostname github.com --user ORESoftware 2>/dev/null || true)"
if placeholder "$token"; then
  token="$(gh auth token --hostname github.com 2>/dev/null || true)"
fi
if placeholder "$token"; then
  print -u2 "github-mcp.sh: no usable GitHub token (gh auth token is empty or from-env)"
  exit 1
fi

export GITHUB_PERSONAL_ACCESS_TOKEN="$token"
unset GH_TOKEN GITHUB_TOKEN

exec npx -y @modelcontextprotocol/server-github
```

Adjust the nvm path if this machine uses a different Node.

**Cursor** — `~/.cursor/mcp.json`:

```json
"github": {
  "command": "/bin/zsh",
  "args": ["/Users/<you>/.cursor/github-mcp.sh"]
}
```

Reload MCP (toggle GitHub in Cursor Settings → MCP, or restart Cursor). A live stdio process
keeps the old bad env until it is restarted.

**Claude Code** — same launcher in `~/.claude.json` (user MCP) or project `.mcp.json`.
Do not duplicate a PAT. Claude Code can also skip MCP and use `gh` / `git` in
the terminal; that is a complete GitHub path by itself.

```json
"github": {
  "command": "/bin/zsh",
  "args": ["/Users/<you>/.cursor/github-mcp.sh"]
}
```

**Codex** — same launcher in `~/.codex/config.toml`. Sandbox must allow `gh`,
`npx`, and `~/.ssh` / keyring. Codex can also skip MCP and use `gh`/`git` with
network enabled.

```toml
[mcp_servers.github]
command = "/bin/zsh"
args = ["/Users/<you>/.cursor/github-mcp.sh"]
```

Verify MCP with a **tool call**, not `ready`. Search users/repos should return `ORESoftware`
and private repos you can already see with `gh`. `Not connected` means the stdio process died
or has not respawned — reload MCP. The banner `GitHub MCP Server running on stdio` on stderr
is normal, not an auth failure. API `owner` is `ORESoftware` (the login), even when
the human says github.com/oresoftware.

### 6. Failover when a path is broken

| Failure | Next path |
| --- | --- |
| MCP `Bad credentials` / `from-env` | Fix launcher **or** ignore MCP and use `gh` + `git` |
| MCP `Not connected` | Reload MCP; meanwhile `gh` / SSH / HTTPS |
| `gh auth token` prints `from-env` | `unset GH_TOKEN GITHUB_TOKEN`; rerun |
| `gh` not on PATH | `/opt/homebrew/bin/gh` or HTTPS `curl` with PAT |
| `gh` logged out / wrong account | `gh auth login` / `gh auth switch --user ORESoftware` **or** SSH **or** PAT in `curl` |
| HTTPS git auth failed | `git remote set-url` to SSH |
| SSH `Permission denied` | HTTPS + `gh auth setup-git` **or** PAT |
| API 401 | Refresh `gh auth token` or the approved credential helper; do not keep retrying `from-env` |
| `protected branch hook declined` / non-fast-forward on `main` | Push a feature branch and open a PR. Do not force-push. |

Pushing, creating repos, and opening PRs must still happen if MCP is down: `git push` (SSH or
HTTPS) plus `gh pr create`, or the GitHub API via `curl`. Figure it out.

### What not to do

* Do not leave `"GITHUB_PERSONAL_ACCESS_TOKEN": "from-env"` in Cursor, Claude Code, or Codex MCP config.
* Do not put a PAT in this repo, in committed MCP JSON, or in chat as the MCP env value.
* Do not treat one healthy probe (`gh auth status`, MCP `ready`, or `ssh -T`) as proof of all paths.
* Do not stop after a single failed method.

## Agents reaching Linear — more than one way

Same rule as GitHub: there is never an excuse to be unable to read or update
Linear. Linear is authoritative for scope, priority, status, ownership, and
acceptance criteria. GitHub is authoritative for branches, commits, CI, reviews,
and merge state. When they disagree, say so; do not silently pick one.

Paths, in order (or in parallel):

1. Linear MCP HTTP OAuth — Claude Code uses `https://mcp.linear.app/mcp` and
   `https://mcp.linear.app/mcp/readonly`. Prefer readonly for audits.
2. Linear MCP stdio (`@sylphx/linear-mcp` or similar) — only if
   `LINEAR_API_KEY` is a real key, **not** the literal `from-env`.
3. Linear GraphQL: `https://api.linear.app/graphql` with
   `Authorization: <fallback lin_api_ token in this file, or a user-pasted token>`.
4. The Linear web UI is for humans. Agents use 1–3.

`LINEAR_API_KEY=from-env` is the same bug class as GitHub MCP. Unset it or
replace it. Do not paste the Linear token into committed MCP JSON.

Do **not** delete, archive, cancel, or close a Linear issue without the human
naming that action. Do **not** close a Linear issue whose PR is unmerged and
call it Done. Search before creating; prefer relating (`related`, `duplicate`,
`blocked by`) over a second issue. Include `DEN-<n>` in the git branch and PR
title (see the mapping at the top of this file).

A green Linear MCP `namespaceStatus: ready` is not proof of auth. If MCP fails,
use GraphQL with the fallback token. If GraphQL fails, say which path you tried
and which error you got — then try the other path. Figure it out.


## Plan first, code second

Agents can lose work when they use destructive Git operations or start implementation
without leaving a durable plan. Before coding, publish the plan in Linear (use a
comment on the existing issue when appropriate) and in a GitHub issue. Preserve
working changes by committing explicit paths on a scratch or feature branch before
switching tasks. Never use `git stash`, `git reset`, rebase, or force-push as a
shortcut; follow the recovery and semantic-merge rules below.

## Red PRs, stale PRs, and mandatory cherry-pick

This applies to **every GitHub org we own** (product orgs, sibling `*-test` orgs, and the `ORESoftware` user namespace). When CI on an open PR is red instead of green, agents must try to get it green. When a PR is old, outmoded, or redundant, a comment is allowed instead of fully resurrecting that PR — **but discarding the branch without salvage is forbidden**.

for example:
at one point, claude agent said "Theirs is better than ours on the central point"...but, remember our cherry-picking instruciton/directive - never discard whole branches in favor of others - make sure to take the good parts even from branches that are otherwise outmoded - this instruction must be in oresoftware/my-ai/AGENTS.md

### Try to make red PRs green

1. Open PRs across all orgs. A PR is "red" when its latest commit status rollup is `FAILURE` or `ERROR`, or required checks failed.
2. Diagnose the failure from the job log, not from the title. Typical classes:
   - real test / type / lint / contract failure → **fix the PR** (merge `origin/main` into the PR branch with a merge commit, not rebase; resolve conflicts semantically with at least 5 commits of history; push; re-run checks).
   - merge conflict / `DIRTY` → **merge main in**, do not rebase, do not stash.
   - GitHub Actions minutes exhausted, spending limit reached, or a failed account payment — the job never starts, dies in seconds with no steps, and the annotation reads "The job was not started because recent account payments have failed or your spending limit needs to be increased" → **cannot code-fix to green**. This is a billing setting, not a code defect: do not attempt code changes, do not close the PR, and never touch billing yourself. Comment that the check is budget-blocked, move unique work to a salvage PR or a `*-test` org that still has minutes, and tell the human which orgs are affected so they can raise the limit. Re-run the workflows once they say it is lifted.
   - Dependabot bump with red CI → update the bump against current `main` if the dependency is still wanted; otherwise salvage any accompanying lockfile / workflow pin that is still correct.
3. Push the fix to the existing PR branch when the PR is still the right vehicle. Open a new PR only when the old one is the wrong vehicle (wrong base, superseded product direction, or the original author path is abandoned).
4. Sibling `*-test` orgs exist in part so we can spend GHA minutes there when the product org is on budget.
5. Before declaring a fleet-wide campaign, classify the whole fleet first and count the failure classes. Red at this scale is nearly always a handful of root causes (one shared workflow, one unpinned action, one missing secret, one billing setting) wearing hundreds of faces. Fix the root cause once; do not hand-patch 200 PRs.

### Old / outmoded / redundant PRs: comment, do not throw the work away

**A pull request is never merely closed. Never.** Before a PR is closed, marked stale, superseded, or abandoned, the agent must first extract everything of value from it and land that value somewhere durable. Closing a PR without a recorded salvage pass is a defect, and is treated the same as deleting work.

Old, outmoded, redundant, conflict-ridden and half-finished PRs are the *highest*-value salvage targets, not the lowest. They are where an idea was tried once, learned from, and then lost when the branch went cold. The reason a PR is stale is almost never that its ideas were wrong; it is that the surrounding code moved. **Cherry-pick aggressively. This is critical.**

A PR may be treated as stale (comment instead of driving it to merge) when **all** of the following are true, or when a human has said it is obsolete:

- it is clearly superseded (same change already on `main`, or a newer PR covers the same intent), **or**
- it is months stale with no unique product direction left, **or**
- it is a duplicate fleet campaign (identical title across many repos) whose unique hunks have already been harvested.

Then:

1. **Comment on the original PR** explaining why it is not being driven to green, and **link every salvage commit / salvage PR**. Do not close it unless a human asked to close it.
2. **Cherry-pick is mandatory.** Try very hard to keep the good parts. Read the full PR diff and at least 5 commits of history on both the PR branch and `main`. Harvest, at minimum:
   - tests, contracts, JSON Schema, FORCE RLS, fail-closed parsers, and typed-error paths
   - hardening (CSP, query allowlists, digest-only storage, no secrets in fixtures)
   - unique docs, Linear/ticket links, and workflow pins that `main` still lacks
   - generated artifacts that match current generators (re-run generate rather than copying stale generated files blindly)
   - bug fixes that are still live bugs on `main`/`dev` today — verify against current HEAD before assuming they were fixed elsewhere
   - type and interface refinements: narrower types, exhaustive matches, newtypes, schema tightening. These land cleanly far more often than implementations do
   - error handling and typed errors: a PR that introduced a proper error enum where there was a `String` is worth harvesting even if nothing else in it is
   - dependency bumps that are still ahead of what `main` has
   - documentation, comments, ADRs and commit messages that explain *why*. If nothing else survives, the reasoning goes into the repo's `docs/` or an ADR
   - utility and helper functions. Small pure functions are the single most portable unit of salvage; move them into the repo's shared util module even if the caller is dropped
   - CI, lint, formatting and toolchain changes: pinned versions, cache keys, matrix entries, workflow fixes. Nearly always still applicable
   - config, manifests and schema migrations: k8s YAML, Cloudflare config, `zed-pkg` descriptors, `declarative-migrations` files
   - performance work and benchmark harnesses
   - **negative knowledge** — an approach that was tried and abandoned. Record it in the PR comment and in `docs/` so it is not re-attempted
   - a test written for a feature that never landed still encodes a real invariant. Land the test even if you drop the feature; mark it `#[ignore]` / `it.skip` / `@Skip` with a comment pointing at the PR if the code it exercises does not exist yet
3. Apply salvage with `git cherry-pick` (or a merge commit of a salvage branch). **Do not rebase. Do not stash. Do not reset.** If a cherry-pick conflicts, resolve semantically — not by picking one side.
4. Empty, secret-bearing, or provider-UI-automation hunks are the exception: do not salvage those; say so in the comment.
5. Duplicate fleet titles (for example "Freeze generated files…" on 40 repos) still need a per-repo skim: one repo may have a real unique fix hiding under a copy-pasted title.

### Salvage procedure (do all of it)

1. **Read the whole diff, not the summary.** `git fetch origin pull/<N>/head:pr-<N>` then `git diff $(git merge-base pr-<N> origin/main)..pr-<N>`. Read every hunk.
2. **Read the discussion.** Review comments frequently contain the good idea that the code itself never got right.
3. **Diff against today.** For each hunk decide: *already landed*, *still needed*, *obsolete*, or *needs translation*. "Needs translation" is the common case and is not an excuse to drop it — port the intent to the current code shape.
4. **Land the salvage on a fresh branch** off current `dev` (or `main` where the repo has no `dev`), named `salvage/pr-<N>-<slug>`. Use `git cherry-pick -x` where a commit applies cleanly so provenance is recorded; otherwise re-apply by hand with a commit message that says `Salvaged from #<N>: <what and why>`.
5. **Resolve any conflicts semantically** — per the git merge rules above, with at least five commits of history on both sides. Never pick a side to make the conflict go away, and never `git rebase`/`git stash`/`git reset` to escape one.
6. **Open the salvage PR and get it green** before touching the original.
7. **Comment on the original PR** with the salvage record (template below), link the new PR, and only then consider closing — and only if a human asked for it to be closed.
8. **If nothing at all is salvageable**, say so explicitly in the comment and justify it hunk by hunk. "Nothing salvageable" is a claim that must be defended, not a default.

### Required salvage-record comment template

```markdown
### Salvage pass — <date>

**Verdict:** superseded / outmoded / redundant / budget-blocked / superseded-in-part
**Why this PR is not being greened as-is:** <one paragraph, concrete>

**Salvaged →** #<new PR> (`salvage/pr-<N>-<slug>`)
- `path/to/file.rs` — <what was taken and why it still matters>
- `tests/foo_test.rs` — <test kept; invariant it encodes>

**Deliberately dropped**
- `path/to/other.rs` — <why: already landed in <sha>, or obsolete because <reason>>

**Negative knowledge recorded**
- <approach tried here that should not be retried, and why> → `docs/adr/<n>-<slug>.md`

Nothing in this PR is lost; it lives in the branch/PR above.
```

### When to green instead of salvage

Prefer greening the original PR in place when the diff still applies to current `main`/`dev` with only mechanical fixes (lint, formatting, a moved import, a renamed symbol, a CI matrix entry, a dependency bump). Reach for salvage only when the PR's structure has genuinely been overtaken by later work. When in doubt, try greening first — it preserves review history.

A salvage PR that is not yet ready is still a draft PR on GitHub, not a stash and not a
local-only branch. Same landing rule as any other work.

### Default assumption: an otherwise-undesirable PR still has something worth keeping

A PR can be the wrong thing to merge **as a whole** — outmoded product direction, duplicate fleet title, months stale, would fight current `main`, author path abandoned — and still contain work we must not lose. **That is the common case, not the exception.** Assume there is something useful in it: a test, a type, a helper, a workflow pin, a contract, a comment, or negative knowledge (an approach that failed and should not be retried).

The job is not "decide whether this PR is worth saving." The job is:

1. Read the full diff and history (see salvage procedure above).
2. Cherry-pick every unique, still-valuable hunk onto a **new** branch `salvage/pr-<N>-<slug>` off current `dev` (or `main` if the repo has no `dev`).
3. **Open a new GitHub pull request** from that branch. A local cherry-pick, a comment, or a "we'll get to it" note is not done. Done means the salvaged work is on GitHub as its own PR, linked from the original.
4. Comment on the original with the salvage-record template and the new PR URL. Leave the original open unless a human asked to close it.

Do not wait to be asked whether to open that salvage PR. The original PR may be undesirable to merge; the salvage PR exists so we do not discard the parts that are still good.

### What not to do

* Do not close or ignore a red PR because CI is red without reading the diff.
* Do not drop a stale PR's unique tests or hardening because the rest of the PR is obsolete.
* Do not rebase the stale branch onto main "to make cherry-pick easier."
* Do not force-push, and do not skip hooks, unless a human explicitly asked.
* Do not close a PR with a bare "stale", "superseded", "closing in favour of #X", or a bot-style message. A link to a replacement PR is not a salvage pass unless the salvage record above is present.
* Do not delete the head branch of a salvaged PR until the salvage PR has merged.
* Do not treat merge conflicts, a red build, or a long-dead branch as evidence that the content is worthless. Those are properties of the branch's age, not of its ideas.
* Do not batch-close PRs. Each one gets its own read and its own comment.
* Do not treat "we should not merge this PR" as "throw the branch away." Cherry-pick first, open the salvage PR, then decide what to do with the original.
* Do not leave salvaged work only on a laptop or only in a comment. If it is not a GitHub PR, it can still disappear.
* Do not salvage by force-push, rebase, or `git reset`. Cherry-pick `-x` or re-apply by hand onto a fresh branch, then merge.
* Do not copy this file (`AGENTS.md`) into another repo as "salvage": it is machine-specific, and its history carries credentials that must not be republished. Salvage the *rules*, not the file. The pointer block in `lib/agents-pointer.md` is what other repos should carry.
* Do not close the Linear issue that owns a salvaged PR until the salvage PR has merged. Linear Done requires the GitHub merge (see Linear section).

## Rust-first systems programming and scripting

Use Rust by default for systems-facing code and executable automation,
including CLIs, build and release tooling, contract-parity and schema/ORM
convergence checks, code-generation orchestration, security and secret-policy
validation, fleet audits, and long-lived repository scripts. Prefer Rust's
explicit types, exhaustive matching, memory safety, deterministic error
handling, and single-binary deployment over Python for these responsibilities.

Before replacing an existing Python tool, run its current positive and negative
tests and capture its observable CLI, output, and exit-code contract. The Rust
replacement must preserve intended behavior, add fixture or golden parity
tests, reject malformed input fail-closed, and eliminate any false-positive
validation paths found during migration.

Do not use Python for code generation, checks, validators, CI gates, or
repository scripts. Do not add new `.py` tooling files, and do not add
`python`/`python3` invocations (including `python -c` one-liners and pip/venv
installs) to workflows, package scripts, or agent procedures. Agents writing a
generator or check write it in Rust from the start; ad-hoc inspection uses `jq`
or existing Rust/Node tools.

Existing Python tooling is migration debt, not precedent: do not extend it. A
passing Python implementation may remain only until its Rust port lands, and
it must have an open draft PR or tracked Linear item that records the Rust
owner and migration boundary. Do not treat "the script is small" as a reason
to keep systems or policy logic dynamically typed.

Python is acceptable only where its ecosystem is materially required, such as
data science, notebooks, model experimentation, or a vendor toolchain with no
practical Rust alternative. That exception never covers code generation,
checks, validators, CI gates, or repository scripts.

## Critical: never discard uncommitted working-tree changes — in any repo

Local, uncommitted changes in a working tree are **work**. They are never
disposable, never "in the way", and never yours to throw out. Losing them is
treated exactly like deleting a pushed branch: a defect that must be reported,
not a cleanup step.

On 2026-09-04 uncommitted edits to this very file (and two new docs) were wiped
from a checkout by a pull that overwrote the working tree. The only reason
they survived at all was a rescue snapshot (`rescue/wip-main-citadel-20260904`)
taken minutes earlier. Do not let that happen again, in this repo or any other.

### Rules

* **Look before you touch.** Before any `git pull`, `git merge`, `git checkout`,
  `git switch`, `git reset`, `git clean`, `git rebase`, or `git worktree`
  command that can rewrite the working tree, run `git status --porcelain` and
  `git stash list`. If the tree is not clean, stop and preserve the changes first.
* **Preserve, then sync.** Commit the uncommitted changes to a scratch/WIP
  branch (`wip/<what>` or `rescue/<what>`), using explicit paths, never `-A`,
  and push it. Only then pull or merge. A stash is not preservation — it is
  invisible and unpushed (see the Stashes guidance in `~/codes/AGENTS.md`).
* **Never force.** `git pull --force`, `git fetch --force` into the checked-out
  branch, `git reset --hard`, `git checkout -- <path>` / `git restore <path>`
  on a path with local edits, `git clean -f`, `git stash drop`/`clear`, and
  `git checkout -f` / `git switch -f` / `git worktree remove --force` are all
  forbidden unless a human names the command and the path in the same message.
  "Discard local changes" is never an implied step of "sync", "update",
  "get latest", "resolve the conflict", or "make CI green".
* **A dirty pull that fails is the correct outcome.** When `git pull` refuses
  because local changes would be overwritten, that refusal is git protecting
  the work. Do not "fix" the refusal by discarding; fix it by committing the
  work to a branch and then merging.
* **This is fleet-wide.** It applies to every repo under `~/codes`, every org,
  every machine, and every agent (Claude Code, Cursor, Codex, Cowork, CI and
  rollout scripts). A fleet script that pulls across many checkouts must skip
  any checkout with a dirty tree and report it, never overwrite it.
* **Other sessions' work counts too.** Several agents share these checkouts.
  Edits you did not make are still not yours to discard. If you cannot tell
  whose they are, preserve them on a `rescue/<machine>-<date>` branch and push
  it, then say so in the turn summary.
* **If it already happened,** recover immediately before anything else:
  `git fsck --lost-found`, `git reflog`, `git stash list`, editor/IDE local
  history, and any `rescue/*` branches on the remote. Land what you recover on
  a pushed branch and record what was lost and how in the turn summary.

## Critical: git worktrees live in `<repo>/tmp/worktrees/`; `tmp/` and `temp/` are always ignored

When a human has authorized a worktree (see the worktree rule above — never
create one on your own initiative), it goes **inside the repository it belongs
to**, under the **primary checkout's** `tmp/worktrees/` (spelled `worktrees`).
Run these commands from that primary checkout, after the ignore rules below
have landed; do not nest a new worktree inside an existing linked worktree:

```bash
git check-ignore -q tmp/worktrees/.location-probe
mkdir -p tmp/worktrees
git worktree add tmp/worktrees/<branch-slug> <branch>
```

Never put a worktree next to the repo, in `~/codes/` directly, in `/tmp`, or in
any other sibling or parent directory. A worktree that is a direct child of
`~/codes/` looks like a repo to every fleet script and every agent, gets
scanned, gets "synced", and gets its unpushed work stranded when someone
tidies `~/codes/`. Inside `tmp/worktrees/` it is unambiguous, invisible to
`git status` of the main checkout, and cleaned up with the repo.

For cleanup explicitly authorized by the human, inspect `git worktree list
--porcelain` first. A scratch-looking directory can be an ordinary clone or a
submodule; neither is a linked worktree to remove. Confirm the owning
repository and remote, and coordinate with any active agent before touching
its checkout. `origin` may be the test organization while a separate remote
owns production `main`.

Before removing each worktree:

1. Inspect tracked edits, staged edits, untracked files, ignored files, locks,
   and at least five commits of history on both sides (all available history
   for a younger branch). Preserve unique files, including ignored source.
2. Commit reviewed changes with explicit paths, push the branch, resolve
   conflicts by preserving intent, run relevant checks, and land through a PR
   into the correct remote `main`. A pushed but unmerged branch is not cleanup
   completion.
3. Fetch and prove the worktree tip is an ancestor of that remote `main`.
   For a squash merge, also verify the merged PR's exact head and compare the
   complete trees or account for every remaining hunk. A matching PR title is
   insufficient. Retain the source branch; removing the checkout does not
   require deleting its history.
4. Recheck the worktree's HEAD and clean status immediately before
   `git worktree remove <path>`, without `--force`. Verify its registration is
   gone. Never use a filesystem deletion command to remove a worktree.

For relocated or interrupted worktrees, inspect and use `git worktree repair`
before assuming that Git's error means the files are disposable. Preserve
stale lock/index evidence and verify no process owns it before repair. Do not
blanket-prune registrations: a missing path may belong to a moved checkout.
If a worktree remains needed, keep its work intact and relocate it with Git
to the authorized primary checkout's `tmp/worktrees/`.

**Every repository's `.gitignore` must ignore `tmp/` and `temp/`** (the
directories at any depth — use the trailing-slash form, not `tmp` bare, so a
file legitimately named `tmp` is unaffected):

```gitignore
tmp/
temp/
```

Add both lines when you touch a repo that lacks either one. Do not put build
outputs, scratch files, downloads, or worktrees anywhere else — `tmp/` is the
one sanctioned scratch location, and the ignore rule is what makes `git add`
with explicit paths safe in a checkout that also holds scratch work.
