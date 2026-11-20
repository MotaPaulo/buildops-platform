# Review — Verification lens (cloud deployment spine)

- **Spine:** `architecture-cloud-deployment.md` (draft, 2026-11-19)
- **Lens:** checks that every committed decision has been researched or tested against reality rather than taken from training data. That covers versions, whether each technology still exists and fits, and whether each command or feature works the way the spine says.
- **Reviewed:** 2026-11-19, against current vendor docs and the repo (`package.json`, `apps/mobile/app.json`, `apps/mobile/package.json`, `supabase/config.toml`, `node_modules/supabase` = 3.2.0, git history).

## Verdict

**Sound with fixes.** The hosting split and the named services all exist and fit. Supabase sa-east-1, Pro at $25 with $10 compute credit, 7-day daily backups, the S3 endpoint, EAS fingerprint/channels/internal distribution, and GitHub OIDC were all confirmed. The problems are in the details below the headline decisions:

1. one stale Stack version (Node);
2. a missing mechanism in AD-6 for EAS Update, which can send a wrong-backend bundle to phones;
3. Supabase CLI v3 flag changes plus an unverified `env()` assumption in AD-5;
4. backup mechanics in AD-9 that fail as written on GitHub-hosted runners;
5. the new GitHub OIDC `sub` claim format, which applies to this repo.

## Findings

### F1 — Stack: Node `≥ 20` is stale for Expo SDK 58 [HIGH]

- **What's wrong:** Expo SDK 58, released 2026-10-15, says: "Expo tooling now requires Node.js 22.13 or newer on the 22 line, 24.3 or newer on the 24 line, or Node.js 26 and later." The spine's Stack row and root `package.json` `engines.node: ">=20"` both allow Node 20, which SDK 58 tooling rejects. CI that follows the Stack table (`setup-node` with 20) will break `expo export` and `eas` steps.
- **Fix:** Stack: `Node | 22.13+ / 24.3+ (CI pins 24 LTS)`. Raise `engines.node` to match.
- **Source:** https://expo.dev/changelog/sdk-58

### F2 — AD-6 / AD-8: EAS Update does not read `eas.json` build-profile env; `--environment` is required [HIGH]

- **What's wrong:** AD-6 says mobile gets `EXPO_PUBLIC_*` "from the `eas.json` build profile / EAS environment". `EXPO_PUBLIC_*` values are inlined into the JS bundle at publish time. Expo's docs say: "When publishing an update, specify the environment with the required `--environment` flag … Only the environment variables from the specified environment will be used." The `env` block of a build profile applies to builds, not to `eas update`. The trap: a binary built against staging Supabase receives an OTA bundle whose URL came from the wrong source (or from a stray `.env`). It then points at the other backend, which is exactly what AD-6 is meant to prevent.
- **Related trap:** AD-3 promotes "the same commit" to production. Promoting the staging update with `eas update:republish --destination-channel production`, which the EAS docs suggest, would ship a bundle with the staging URL inlined. Production must re-export with `--environment production`.
- **Fix:**
  - AD-6 rule: mobile `EXPO_PUBLIC_*` live only in **EAS environment variables** (`preview`/`staging` and `production`). Each `eas.json` build profile sets `"environment"` and `"channel"`. Every `eas update` runs with `--channel <env> --environment <env> --non-interactive`.
  - Ban `update:republish` across environments.
  - Remove "eas.json build profile" as an env source.
- **Source:** https://docs.expo.dev/eas-update/environment-variables/ , https://docs.expo.dev/eas-update/deployment/

### F3 — AD-5: Supabase CLI v3 command shapes and the `env()`-in-`config push` assumption are unverified [MEDIUM-HIGH]

- **CLI v3 flag changes (verified):** In CLI v3, the repo's 3.2.0:
  - `db push` targets the **local** DB by default. `--linked`/`--db-url`/`--project-ref` are "deprecated and removed in v4; use `--remote`".
  - Hosted-changing commands ask for confirmation, with "the default answer … no". `db push` needs `--yes` in CI.
  - `config push` and `functions deploy` take `--remote[=<ref>]`. `--project-ref` is deprecated on `config push`.
  - `supabase link` reads `SUPABASE_DB_PASSWORD`, which matches the secret name.
  - `functions deploy --use-api` avoids needing Docker on the runner.
  - The official managing-environments guide still shows `setup-cli@v1` with `version: latest`. setup-cli's README says `@v1`/`@v2` are legacy and `@v3` is current.
- **`env()` with `config push` (unverified):** The docs confirm `config.toml` supports `env()` and reads `supabase/.env`. Neither the config guide nor the `config push` reference says `config push` resolves `env()`. Open issues report `env()` not expanding in some fields (`site_url` locally, array values such as `sql_paths`). `additional_redirect_urls` is an array. The repo's local `site_url` is a literal `http://127.0.0.1:3000`. Turning it into `env(SITE_URL)` would also make local `supabase start` depend on a `supabase/.env`.
- **Fix:**
  - Rewrite AD-5's commands as: `supabase link --project-ref $SUPABASE_PROJECT_REF`, then `supabase db push --remote --yes`, `supabase config push --remote --yes`, and `supabase functions deploy --remote --use-api`.
  - Pin `supabase/setup-cli@v3` with `version` matching `package.json` (`3.2.0`), not `latest`.
  - Add a Deferred/spike item: run `config push --dry-run` (or `config diff`) against staging with `env()` in `site_url` and `additional_redirect_urls`. If array expansion fails, fall back to a per-environment `[remotes.<ref>]` override block or full-string `env()` per URL.
  - Note that local dev needs a committed `supabase/.env.example`.
- **Source:** https://supabase.com/docs/reference/cli/supabase-db-push (v3 reference covering `db push`/`config push`/`functions deploy`/`link`), https://supabase.com/docs/guides/local-development/managing-config , https://supabase.com/docs/guides/deployment/managing-environments , https://github.com/supabase/setup-cli , https://github.com/supabase/supabase/issues/23296 , https://github.com/supabase/cli/issues/2774

### F4 — AD-9: backup mechanics fail as written on GitHub-hosted runners [MEDIUM-HIGH]

- **Connectivity:** Supabase's direct DB host is "IPv6 unless IPv4 Add-On is enabled". GitHub Actions is named as IPv4-only. A plain `pg_dump` against `db.<ref>.supabase.co` from `backup.yml` will not connect. The **session-mode pooler (port 5432)** "always uses an IPv4 address".
- **Tool choice:** Supabase recommends `supabase db dump` for off-platform logical backups. Raw `pg_dump` also needs a client that matches **Postgres 17**, which the ubuntu runner does not provide by default. Daily backups do not keep custom-role passwords.
- **Storage S3 credentials:** Verified: endpoint `https://<ref>.storage.supabase.co/storage/v1/s3`. ListObjectsV2, GetObject and HeadObject are implemented, so an `aws s3 sync`/rclone pull is feasible (docs flag a known rclone listing quirk). It needs **Supabase S3 access keys**, which are full-access and bypass RLS. They are a new secret that does not appear in the Secrets naming convention. Pro daily backups exclude Storage objects ("Database backups do not include objects you store via the Storage API"), so this sync is the *only* photo backup. That is a good reason to keep it.
- **Fix:**
  - AD-9 rule: the dump uses `supabase db dump` (data + schema + roles) or `pg_dump` 17 through the **session pooler URL**.
  - Add secrets `SUPABASE_DB_URL_POOLER` (or reuse link + `SUPABASE_DB_PASSWORD`), `SUPABASE_S3_ACCESS_KEY_ID` and `SUPABASE_S3_SECRET_ACCESS_KEY` to the Secrets naming row, scoped to the production Environment only.
  - Note the alternative (IPv4 add-on) and its cost.
- **Source:** https://supabase.com/docs/guides/platform/ipv4-address , https://supabase.com/docs/guides/platform/backups , https://supabase.com/docs/guides/storage/s3/authentication , https://supabase.com/docs/guides/storage/s3/compatibility

### F5 — AD-6: GitHub OIDC `sub` claim format changed for repos created after 2026-07-15 [MEDIUM]

- **What's wrong:** The OIDC approach is verified: `permissions: id-token: write`, `aws-actions/configure-aws-credentials`, and a trust policy on `token.actions.githubusercontent.com:sub = repo:ORG/REPO:environment:NAME` with `aud = sts.amazonaws.com`. However, GitHub's docs say "Repositories created after July 15, 2026, or that opted in, use immutable owner and repository IDs in the `sub` claim, such as `repo:octo-org@123456/octo-repo@456789:...`". The repo's first commit is 2026-11-18 (`origin` = `github.com/MotaPaulo/buildops-platform`), so it almost certainly gets the new format. A trust policy written from older examples will deny every assume-role. The ID-based claim also survives the AD-10 transfer to Corx only if the repo is transferred, not re-created.
- **Fix:** AD-6: "one IAM role per environment whose trust policy matches the `sub` exactly as GitHub issues it for this repo (immutable-ID format), scoped to `environment:staging` / `environment:production`". Verify the `sub` by printing the claim once before writing `infra/`. Add the OIDC trust to the AD-10 transfer checklist.
- **Source:** https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws

### F6 — Conventions/Web routing: keep `web.output: "single"` explicit; CloudFront fallback mechanism unspecified [LOW]

- **Verified:** `single` "Outputs a Single Page Application (SPA) with a single index.html". It is still supported, and the repo sets it explicitly. In SDK 58 an **unset** `web.output` defaults to `server`, which a static S3 host cannot serve. Expo's hosting guide covers Netlify/Vercel/Firebase rewrites but not S3/CloudFront.
- **Fix:**
  - Add an invariant line: "`web.output` stays `"single"` (unset means `server` in SDK 58+)".
  - Name the CloudFront mechanism: either a CloudFront Function rewriting extension-less paths to `/index.html`, or custom error responses for 403/404 → `/index.html` with 200 behind OAC. Error responses also mask real asset 404s, so prefer the Function.
  - The docs spell the command `npx expo export -p web` (`--platform web` is equivalent).
- **Source:** https://docs.expo.dev/guides/publishing-websites/ , https://expo.dev/changelog/sdk-58

### F7 — AD-8: fingerprint and versioning interplay (confirmation plus one caveat) [LOW]

- **Verified:** the `fingerprint` runtimeVersion policy exists ("increment the runtime version whenever anything that may impact the native runtime changes"). SDK 58 defaults fingerprinting to the `balanced` preset, which ignores the app.json `version` field. So AD-4 writing the version into `app.json` does **not** force a new binary on every release, which is good and consistent.
- **Verified:** internal distribution gives an APK when `distribution: internal`. iOS internal (ad hoc) needs a paid Apple account, registered UDIDs, a rebuild per new device, and is capped at 100 devices per year. TestFlight, as the spine chose, avoids the UDID work.
- **Caveat:** the spine does not say how CI decides "fingerprint changed → build first". Suggest that `production.yml` compares `eas fingerprint` (or `expo-updates` fingerprint) against the latest build for the channel and fails the OTA job if no matching build exists.
- **Source:** https://docs.expo.dev/eas-update/runtime-versions/ , https://docs.expo.dev/build/internal-distribution/ , https://expo.dev/changelog/sdk-58

## Verified as stated (no change needed)

| Claim | Status | Source |
| --- | --- | --- |
| Supabase region São Paulo `sa-east-1` | Listed as a specific region | https://supabase.com/docs/guides/platform/regions |
| Pro plan price / compute credit | From $25/mo, billed per org. $10/mo compute credit covers one Micro ($10). A second project (staging) adds about $10/mo of compute. Spend cap on by default | https://supabase.com/pricing , https://supabase.com/docs/guides/platform/billing-faq |
| Daily backups on Pro | Yes, 7-day retention. PITR is an add-on. Storage objects excluded | https://supabase.com/docs/guides/platform/backups |
| Storage S3-compatible endpoint | Yes. Access keys or session token. List/Get/Head supported | https://supabase.com/docs/guides/storage/s3/compatibility |
| Postgres 17 | Matches `supabase/config.toml` `major_version = 17` | repo |
| Supabase CLI 3.x | `node_modules/supabase` = 3.2.0 | repo |
| Expo SDK 58 | Released 2026-10-15, RN 0.88. Repo `expo ~58.0.26`, RN 0.88.1 | https://expo.dev/changelog/sdk-58 |
| EAS channels per build profile | `"channel"` key per profile. `eas update --channel` | https://docs.expo.dev/eas-update/deployment/ |
| `enable_signup = false` (AD-7) | Present in `supabase/config.toml` | repo |
| App reads `EXPO_PUBLIC_SUPABASE_URL` / `_KEY` (AD-6) | `apps/mobile/src/lib/supabase.ts` | repo |
| pnpm 12.18.0 | `packageManager` in root `package.json` | repo |

## Minor notes

- There is no `develop` branch yet: `git branch -a` shows only `main` and `backup/pt-history`. AD-3 implies creating it, so add that to the first pipeline story.
- The cost line is not in the spine. The real Supabase figure for two projects is about $35/mo before usage ($25 + 2×$10 − $10 credit). It is worth recording under Deferred → compute size, since AD-2 doubles projects.
