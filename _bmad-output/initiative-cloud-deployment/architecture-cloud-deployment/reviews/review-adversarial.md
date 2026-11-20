---
review-of: architecture-cloud-deployment.md
lens: adversarial (construct AD-compliant units that still clash; flag silent operational dimensions)
date: 2026-11-19
verdict: NOT READY — sound paradigm, but the spine fixes *where* things deploy and leaves *in what order, against which schema, and from which source of truth* open. Several AD-compliant pairs break production.
---

# Adversarial review — Cloud deployment spine

## Verdict

The hosting split (AD-1), environment isolation (AD-2) and test-data rule (AD-7) hold up. The holes
are all **one level down**: two workflows, or a workflow plus an app change, can each follow every AD
to the letter and still break production. The four that matter most:

1. **Schema vs. installed clients.** Nothing ties a migration to the mobile JS already on phones
   (F1). Forward-only (AD-5) is not the same as backward-compatible.
2. **Deploy order inside a pipeline.** `db push`, `functions deploy`, `config push`, web sync and
   `eas update` have no order (F2).
3. **The release PR is not a frozen artifact.** "The same commit" (AD-3) is not enforced, and the
   merge strategy is not set (F3, F4).
4. **AD-4 vs. AD-8.** Writing the version into `app.json` can change the `fingerprint` on every
   release, so OTA updates never match installed binaries (F5).

All findings below give the pair, the AD it hits, and a proposed rule.

---

## A. Clashing pairs (every unit obeys the ADs; together they fail)

### F1 — A migration ships, but phones still run old JS (CRITICAL)
- **Pair:** (a) a story renames or retypes a column, or replaces an RPC signature. The repo already
  did this: `20261123000000_review_fixes.sql` re-creates the transfer function, and
  `20261120000000_master_data_rules.sql` drops and re-creates `warehouses_site_id_fkey`. It is a
  correct forward-only migration (AD-5). (b) The app change that uses the new shape ships as an EAS
  Update (AD-8).
- **Clash:** `production.yml` applies the migration in seconds. Installed apps only pick up an EAS
  Update on the *next cold start after download*, so for hours or days the phones run old JS that
  calls the old RPC or column and fails. A user who never reopens the app stays broken. The web
  bundle has the same problem in any open tab, since `index.html` is not cached but a running SPA is
  not reloaded.
- **AD affected:** AD-5 (forward-only ≠ compatible), AD-8.
- **Proposed rule (new AD-11, Schema compatibility window):** *Every migration must keep working
  with the app JS of the previous production release (expand → migrate → contract). A destructive
  change (drop or rename of a column, table, RPC argument or policy that the client uses) ships only
  in a release **after** the one that stopped using it, and only once a minimum-version gate (an
  `app_min_version` row read at startup that forces an update or reload) has been raised above the
  last release that used it. CI flags `drop`, `rename` and `alter … type` in new migrations and
  requires a `-- contract: safe-after vX.Y.Z` annotation.*

### F2 — No deploy order: function before schema, OTA before schema (HIGH)
- **Pair:** `staging.yml`/`production.yml` runs jobs in parallel for speed: `functions deploy`
  ‖ `db push` ‖ web sync ‖ `eas update`. All of them obey AD-3, AD-5 and AD-6.
- **Clash:** `admin-users` relies on director checks and functions added in
  `20261124000000_user_management.sql`. If it deploys before `db push`, it returns 500. The OTA and
  web bundle can also reach users before the schema they need exists. In the other direction, if
  `db push` fails halfway (it runs one transaction per file), the web and OTA jobs still run.
- **AD affected:** AD-3, AD-5.
- **Proposed rule (tighten AD-5, Deploy order):** *Each environment deploys in this fixed,
  sequential order, and any failure stops the steps after it: (1) tests → (2) `supabase db push`
  → (3) `supabase config push` → (4) `supabase functions deploy` → (5) web sync to S3 →
  (6) `eas update` → (7) tag. Workflows set
  `concurrency: { group: deploy-<env>, cancel-in-progress: false }`.*

### F3 — The release PR moves under review (HIGH)
- **Pair:** (a) Paulo opens the release PR at `v1.4.0-rc.2` and tests staging. (b) Another
  `feat:` commit lands on `develop`. Following AD-3, that push updates the *same* PR and starts a
  staging deploy that is still running, or has failed, when Paulo clicks merge.
- **Clash:** what reaches production is not what was tested (rc.2). It is rc.3, possibly unverified
  or with a red staging run. "Merging deploys the same commit" is also false as written: a merge
  commit on `main` has a new SHA. AD-4 then computes `v1.4.0` from a commit set that includes the
  untested `feat`.
- **AD affected:** AD-3, AD-4.
- **Proposed rule (tighten AD-3, Promotion = verified SHA):** *`production.yml` deploys only if the
  tree of `main` HEAD is identical to the tree of the newest `vX.Y.Z-rc.N` tag, and the staging run
  for that SHA succeeded. If not, it fails before migrating. Branch protection on `main` requires
  the staging check on the PR head SHA. A new push to `develop` while a release PR is open bumps
  `rc.N` and resets any approval.*

### F4 — Merge strategy undefined: squash breaks both AD-4 and the next release (HIGH)
- **Pair:** (a) the release PR is merged with GitHub's default, "Squash and merge" or "Rebase and
  merge". Nothing in AD-3 forbids it. (b) AD-4 computes the next version from commits since the last
  `vX.Y.Z`.
- **Clash:** a squash merge collapses all `feat:`/`fix:` commits into one titled after the PR. The
  version bump is lost, or set by the PR title. `main` also gets a commit that `develop` lacks, so
  every later release PR shows phantom diffs or conflicts, and the "only develop merges into main"
  topology drifts. A rebase merge rewrites SHAs, so tags on `develop` no longer point at the commits
  on `main`.
- **AD affected:** AD-3, AD-4.
- **Proposed rule:** *The release PR merges by merge commit only (or `--ff-only`). Repo settings
  disable squash and rebase merges for `main`. `main` must always be an ancestor of `develop` after a
  release, and CI checks this.*

### F5 — Version written into `app.json` vs. `fingerprint` runtime (HIGH)
- **Pair:** (a) AD-4: "writes [the version] into … the app version", meaning `expo.version` in
  `app.json`. (b) AD-8: `runtimeVersion: { policy: "fingerprint" }`, which hashes the Expo config.
- **Clash:** depending on the fingerprint source-skips, a version bump changes the fingerprint. Every
  release is then a "native" change, the production OTA finds no compatible binary, and AD-8's
  "binaries rarely, OTA often" collapses. If the pipeline also *commits* the bump, a bot commit to
  `develop` re-triggers `staging.yml` (a loop), or a bot commit to `main` makes it diverge from
  `develop` (same failure as F4).
- **AD affected:** AD-4, AD-8.
- **Proposed rule:** *The release version is injected at build/update time (`app.config.ts` reads
  `APP_VERSION` from CI). The pipeline never commits it to the repo. The fingerprint config skips
  version fields (`sourceSkips: ExpoConfigVersions`, or equivalent), and CI checks that a JS-only
  commit yields the same fingerprint as the last production build. Native `buildNumber`/`versionCode`
  is managed remotely by EAS (`appVersionSource: remote`).*

### F6 — Three owners of the mobile environment variables (HIGH)
- **Pair:** AD-6 allows mobile values to come from "the `eas.json` build profile / EAS environment",
  while web values come from the GitHub Environment. (a) The EAS build reads
  `EXPO_PUBLIC_SUPABASE_URL` from the `eas.json` profile. (b) `production.yml` runs
  `eas update --channel production` in a job that has the GitHub `production` Environment, *or*
  forgets to select it.
- **Clash:** `EXPO_PUBLIC_*` values are baked in when the bundle is built. For `eas update`, that
  happens on the CI runner, not on the EAS build profile. The update bundle can therefore carry
  whatever is in the runner's env: staging values, a stale `.env`, or nothing, in which case the
  client falls back or crashes. The result is a production binary talking to the staging project
  through an OTA, which is exactly what AD-6 is meant to prevent. With three places holding the same
  value, drift is a matter of time.
- **AD affected:** AD-6, AD-2.
- **Proposed rule:** *Mobile `EXPO_PUBLIC_*` values live in exactly one place: EAS environment
  variables (`preview` → staging, `production` → production). Both `eas build` and `eas update` pass
  `--environment <env>`. `eas.json` holds no URLs or keys. After `eas update`/`expo export`, CI greps
  the bundle for the expected `SUPABASE_PROJECT_REF` and fails on the other environment's ref.*

### F7 — `config push` pushes local values; two owners of storage settings (HIGH)
- **Pair:** (a) `staging.yml` runs `supabase config push` (AD-5). (b) `config.toml` today
  hard-codes `site_url = "http://127.0.0.1:3000"` and `minimum_password_length = 6`, and has a global
  `[storage] file_size_limit = "50MiB"`. Meanwhile the bucket `movement-photos` is created in a
  *migration* (`insert into storage.buckets … on conflict do nothing`).
- **Clash:** the first push sets production's site URL to localhost. The same `config.toml` also
  drives `supabase start`, so switching to `env()` without local defaults breaks local development.
  Storage settings then have two owners: if someone adds `[storage.buckets.movement-photos]` to
  `config.toml` (the commented template invites it), `config push` and the migration disagree on
  size limits and MIME types, and the `on conflict do nothing` migration never reconciles them.
  `minimum_password_length = 6` in Auth vs `MIN_PASSWORD_LENGTH = 8` in `admin-users` is another
  split owner, though harmless for now because accounts are only created through the function.
- **AD affected:** AD-5.
- **Proposed rule:** *Every value in `config.toml` that differs between environments is
  `env(VAR)`. Local defaults sit in a committed `supabase/.env` (non-secret), and CI supplies them per
  GitHub Environment. Buckets, including size and MIME limits, are owned by migrations only.
  `config.toml` declares no `[storage.buckets.*]`. Before pushing, CI runs `supabase config push`
  in dry-run/diff mode and prints the diff in the job summary.*

### F8 — Nightly backup vs. a protected production environment (MEDIUM)
- **Pair:** (a) the `production` GitHub Environment gets a required reviewer, the natural way to gate
  `production.yml`. (b) `backup.yml` (AD-9) runs on a schedule and needs `SUPABASE_DB_PASSWORD` and
  `AWS_ROLE_ARN` from that same environment.
- **Clash:** every nightly backup waits for manual approval and times out, so backups silently stop.
  There is also a second problem: the Supabase direct DB host is IPv6-only unless the IPv4 add-on is
  bought, and GitHub-hosted runners have no IPv6. `pg_dump` must go through the session pooler
  (port 5432), and its major version must match Postgres 17. The storage sync needs Supabase S3
  access keys, which are missing from the secrets table.
- **AD affected:** AD-9, AD-6, the Conventions table.
- **Proposed rule:** *`backup.yml` uses its own GitHub Environment `production-backup` (no reviewer)
  with: a read-only DB role (not `postgres`) connecting through the session pooler; a
  `SUPABASE_S3_ACCESS_KEY_ID/SECRET` pair limited to read; and an OIDC role that can only `PutObject`
  to the backup bucket (no delete; versioning plus Object Lock or a lifecycle rule). If no fresh
  backup object exists for 48 h, a failure alert email is sent.*

### F9 — Concurrent pushes to `develop`, and rc vs. final tag lookup (MEDIUM)
- **Pair:** (a) two pushes to `develop` a minute apart start two `staging.yml` runs. (b) Both compute
  `rc.N` from existing tags, and both find "the last `vX.Y.Z`" using `git describe --tags`.
- **Clash:** both runs push `v1.4.0-rc.3`, and the second fails or force-moves the tag. Both run
  `db push` at the same time. `git describe` returns the *rc* tag as "last release", so the version
  logic computes from the wrong base. The checkout also needs `fetch-depth: 0`, or tags are missing
  and every release becomes `v0.0.1`.
- **AD affected:** AD-3, AD-4.
- **Proposed rule:** *Base-version lookup matches `v[0-9]*.[0-9]*.[0-9]*` and excludes `-rc`.
  `rc.N = 1 + max existing rc for that X.Y.Z`, computed inside the `deploy-<env>` concurrency group
  (F2). Tags are never moved or force-pushed. Workflows check out with `fetch-depth: 0`.*

### F10 — Hotfix through `develop` while `develop` holds unreleased work (MEDIUM)
- **Pair:** (a) a half-finished feature, with its migration, is on `develop` and deployed to staging.
  (b) Production needs an urgent `fix:`. AD-3 says hotfixes go through `develop`.
- **Clash:** the hotfix can only reach production together with the unfinished feature and its
  migration. The alternatives are reverting work on `develop` or breaking AD-3. The spine assumes
  `develop` is always releasable but never says so.
- **AD affected:** AD-3.
- **Proposed rule:** *`develop` is always releasable: an unfinished feature is either not merged, or
  merged dark behind a flag (a `feature_flags` row or an env var), and its migrations follow AD-11.
  If an emergency can't wait, the escape hatch is a revert commit on `develop` followed by the normal
  release. Never a direct push to `main`.*

### F11 — `seed.sql` "runs in staging", but `db push` never seeds (MEDIUM)
- **Pair:** AD-7 says seed and test users run in staging. `staging.yml` uses `supabase db push`, as
  AD-5 requires.
- **Clash:** `db push` doesn't run seeds unless given `--include-seed`. With that flag, a
  non-idempotent seed (fixed UUIDs, plain `insert`) fails on the second deploy and blocks staging.
  `create-dev-users.mjs` needs a service key whose secret name is not in the table. If the step were
  ever copied into `production.yml` (same template), AD-7 is violated, and only by convention.
- **AD affected:** AD-7, AD-5.
- **Proposed rule:** *Staging data is loaded by a separate, idempotent, manually triggered
  `workflow_dispatch` job bound to the `staging` environment only. `seed.sql` must be idempotent
  (`on conflict do nothing`). `production.yml` contains no seed or user-script step, and CI checks
  this with a grep.*

---

## B. Operational dimensions left silent

| Dimension | Gap | Proposed rule |
| --- | --- | --- |
| **Rollback** | Forward-only migrations, an OTA, a web bundle and functions each roll back differently; none is described. A plain `aws s3 sync --delete` deletes the previous hashed chunks, so open tabs 404 on lazy routes and the web rollback has nothing to roll back to. | *Rollback = re-run the deploy of the previous `vX.Y.Z` tag through `workflow_dispatch` (allowed exception to AD-3: tag-pinned, Actions-only) for functions, web and `eas update:republish`. The schema never rolls back; it rolls forward, which AD-11 makes safe. Web deploy uploads assets first and `index.html` last, and never deletes assets younger than the last 3 releases.* |
| **Dashboard drift detection** | "Read-only in practice" (AD-5) is not enforced. | *A scheduled job runs `supabase db diff --linked` (schema) and the `config push` dry-run against both projects and fails on any diff.* |
| **Account transfer (AD-10)** | The GitHub repository/organization is missing from the list. The OIDC trust policy pins `repo:<owner>/buildops-platform`, so moving the repo breaks every AWS deploy. The Apple app transfer resets TestFlight testers. The bundle id `com.buildops.app` is not on a Corx-controlled namespace. The EAS project ID must survive the owner change, or the update URL changes. | *Add the GitHub org to AD-10. The OIDC trust `sub` is a parameter in `infra/`. A transfer runbook covers the order: GitHub → AWS roles → Expo → Supabase → stores. Then the backup restore rehearsal (AD-9). Pick the bundle id before the first store upload, because it can never change afterwards.* |
| **Production bootstrap** | AD-7 covers the first director, but not the first `companies`, `cost_centers` and `memberships` rows that RLS (`has_company_access`) needs before anything works. | *Production master data is loaded once by a reviewed SQL script, run by hand and recorded in the release notes, or entered through the master-data screens. Never through `seed.sql`.* |
| **Cost** | Supabase Pro bills per org plus compute per project, so two projects double the compute line. Staging on Pro does not auto-pause. CloudFront, S3, Route 53 and backup versioning are small but unbounded. EAS build minutes and update MAUs are not mentioned. | *An AWS Budgets alarm on the dedicated account, and Supabase spend cap left ON. Record the expected monthly cost per service in the spine. Backup lifecycle: 30 daily copies, 12 monthly, then expire.* |
| **Edge Function JWT / CORS** | `admin-users` returns `Access-Control-Allow-Origin: *`, and `verify_jwt` is implicit. Once the web app runs on a real domain, nothing restricts origins per environment. | *Function config (`verify_jwt`) is declared in `config.toml` per function. The allowed origin comes from a function secret per environment (`app.<domain>` / `homolog.<domain>`).* |
| **Restore objective** | AD-9 rehearses a restore but sets no RPO/RTO, and Supabase daily backups on Pro have 7-day retention with no PITR. | *State RPO ≤ 24 h and RTO ≤ 4 h for the pilot, and measure them in the rehearsal.* |

---

## C. Summary of proposed AD changes

- **New AD-11 — Schema compatibility window** (F1): expand/contract; destructive changes only after a
  min-version gate.
- **AD-5 tightened** — fixed deploy order + per-environment concurrency (F2); `env()` for every
  per-environment config value, buckets owned by migrations, config diff before push (F7); scheduled
  drift check.
- **AD-3 tightened** — production deploys only the tree verified as the latest rc (F3); merge-commit
  only (F4); `develop` always releasable, revert-based hotfix (F10); tag-pinned rollback dispatch.
- **AD-4 tightened** — version injected at build time and never committed; rc-excluding tag lookup;
  `fetch-depth: 0` (F5, F9).
- **AD-6 tightened** — EAS environment is the single owner of mobile `EXPO_PUBLIC_*`; bundle
  project-ref check (F6).
- **AD-7 tightened** — idempotent, dispatch-only staging seed; no seed step in `production.yml`
  (F11); production master-data bootstrap.
- **AD-8 tightened** — fingerprint skips version fields; JS-only fingerprint check (F5).
- **AD-9 tightened** — separate backup environment, read-only role, pooler connection, staleness
  alert, RPO/RTO (F8).
- **AD-10 tightened** — GitHub org included, parameterised OIDC trust, ordered transfer runbook, final
  bundle id chosen early.
