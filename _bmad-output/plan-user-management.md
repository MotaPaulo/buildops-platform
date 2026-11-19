---
title: 'User and membership management by directors'
type: feature
ticket: ''
created: '2026-11-19'
status: built
baseline_revision: 'a5673df244a256803933d03750978ece52481c95'
route: full
route_source: auto
risk: high
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users and their access (role, company, cost center) can only be created by `scripts/create-dev-users.mjs`, so directors can't onboard or remove people. Public sign-up is also open (`enable_signup = true`), so anyone with the app key can create an account.

**Approach:** Directors manage users from a new "Usuários" section in Cadastros. A privileged Edge Function creates and blocks accounts, a director-only RPC lists users with their e-mail, and memberships are written directly under the existing director-only RLS.

## Boundaries & Constraints

**Always:** Only directors manage users and memberships; the database and the Edge Function check it, and the app only mirrors it. The service-role key stays in the Edge Function. Use English for code, docs and commits, and pt-BR on screen. Apply migrations with `supabase migration up` and never wipe local data. Keep test users for each access level.

**Never:** Hard-delete users or profiles, because history references them. Never let the last director lose director access. Managers do not manage users in this change. No password reset by e-mail and no SSO.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create user | director; new e-mail, name, initial access | account and membership created; user listed | No error expected |
| Duplicate e-mail | e-mail already registered | nothing created | "Já existe um usuário com este e-mail." |
| Not a director | manager calls the function or `list_users` | rejected | 403 / 42501 |
| Invalid access | role ≠ director without company; cost center from another company | rejected before insert | pt-BR validation message |
| Last director | removing or blocking the only director | rejected | "É preciso manter ao menos um diretor." |
| Blocked user | blocked user signs in | login fails | "Usuário bloqueado." on login |

## Decisions

- New users get an initial password set by the director and must change it on first login (no e-mail needed).
- Public sign-up is closed: accounts only through directors.
- Removing access: directors remove memberships, and separately "Bloquear acesso" stops login.
- Plan kept whole (~1850 tokens) at the user's choice.

</frozen-after-approval>

## Code Map

- `supabase/config.toml` -- `[auth] enable_signup = true` (line ~181); `[edge_runtime] enabled = true`, but the runtime is stopped while there are no functions.
- `supabase/migrations/20261118000000_inventory.sql` -- `memberships` table and `memberships_select`/`memberships_write` policies (director-only writes); `is_director()`, `handle_new_user()` (creates the profile from `raw_user_meta_data.full_name`).
- `scripts/create-dev-users.mjs` -- the admin API pattern to reuse in the function (`/auth/v1/admin/users`, `email_confirm: true`).
- `packages/shared/src/inventory.ts` -- `Membership`, `APP_ROLES`, `ROLE_LABELS`, `MASTER_DATA_ROLES`/`canEditMasterData` (add `users: []`, director-only).
- `apps/mobile/app/(app)/master-data/index.tsx` -- `SECTIONS` hub; add "Usuários".
- `apps/mobile/app/(app)/master-data/cost-centers/*` -- list/form pattern to copy (`useFocusData`, `ReloadError`, `Fab`, `Chips`, `friendlyDbError`).
- `apps/mobile/app/(app)/_layout.tsx` -- register new screens.
- `apps/mobile/app/login.tsx` -- `signInWithPassword`; map the banned error.
- `apps/mobile/src/lib/supabase.ts` -- client; call the function with `supabase.functions.invoke`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/config.toml` -- `enable_signup = false` -- accounts only through directors (the admin API still works).
- [x] `supabase/migrations/20261124000000_user_management.sql` -- `list_users()` security definer (directors only, else 42501): id, e-mail, name, banned, last sign-in, memberships as JSON. Add a trigger keeping at least one director membership. -- the app can't read `auth.users`.
- [x] `supabase/functions/admin-users/index.ts` -- POST `{action:'create'|'block'|'unblock', ...}`. It verifies the caller's JWT and `is_director` through an RPC under the caller's token. It creates the user with an initial password (and `must_change_password` metadata) plus the first membership, or bans/unbans. It refuses to block the last director or yourself. -- privileged path for the service key.
- [x] `packages/shared/src/users.ts` (+ test) -- `validateAccess({role, company_id, cost_center_id}, costCenters)` and `validateNewUser` (e-mail, name, password ≥ 8) with pt-BR messages -- shared by the screen and the tests.
- [x] `apps/mobile/app/(app)/master-data/users/index.tsx`, `[id].tsx`, `new.tsx` -- list (search, blocked badge) → detail (memberships add/remove, block/unblock) → new user form. Register them in `_layout.tsx` and the hub.
- [x] `apps/mobile/app/(app)/change-password.tsx` + `(app)/_layout.tsx` -- when `user_metadata.must_change_password`, force this screen; it calls `updateUser({password, data:{must_change_password:false}})`.
- [x] `apps/mobile/app/login.tsx` -- show "Usuário bloqueado." for banned accounts.
- [x] `supabase/tests/user_management.test.sql` -- `list_users` director-only; manager can't insert memberships; last-director trigger.
- [x] `docs/inventory.md`, `README.md` -- user management section; restart step for the config change (`pnpm supabase stop` then `pnpm db:start` keeps data).

**Acceptance Criteria:**
- Given a director, when they create a user with an initial password, then that user can sign in, is sent to "Trocar senha" first, and afterwards sees only what the new access allows.
- Given a director, when they remove a user's last membership, then the user's next session shows the "sem acesso" message.
- Given a blocked user, when the director unblocks them, then they can sign in again with their password.
- Given public sign-up is disabled, when someone calls `auth.signUp` with the app key, then it is rejected.

## Design Notes

The Edge Function never trusts the body for identity. It creates a client with the caller's `Authorization` header and calls `rpc('is_director')`, and only then uses a service-role client. Blocking uses `ban_duration: '876000h'`, and unblocking uses `'none'`.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test && pnpm db:test` -- expected: all pass.
- `pnpm supabase db lint` -- expected: no schema errors.
- `pnpm test:functions` -- expected: all admin-users integration checks pass (needs the local stack and `pnpm db:users`).

**Manual checks (if no CLI):**
- Browser e2e as director, manager and the new user: create, first-login password change, block/unblock, membership removal.

## Implementation Notes

- Implemented by a fresh subagent from this plan; all Verification commands passed.
- Matrix audit (step 3): the Edge Function rows had no automated test, so `scripts/test-admin-users.mjs` (`pnpm test:functions`) was added. It covers create, duplicate e-mail, non-director, invalid access, block/unblock and closed sign-up, and deletes its own throwaway accounts.
- The function deleted the new account when the first membership insert failed, which the plan forbids. It now answers 207 with the error and keeps the account, and the app shows the message.
- Leftover throwaway accounts (`e2e.*`) from the implementer's API runs were deleted from the local database.
- Known limits: `must_change_password` lives in user-editable metadata, so a hand-crafted API call can skip the forced change.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick) — 3 medium, 3 low, 1 false, 0 maybe-false; 2 low rejected

| # | Finding | Verdict | Route | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | setBlocked last-director check races with a concurrent block or membership delete | medium | patch | Read-then-write across admin API calls, and the trigger lock doesn't cover bans. Fix: after banning, re-check for another active director and unban if none remains. |
| 2 | A blocked director keeps director powers until the access token expires | medium | patch | is_director/has_* ignore auth.users.banned_until. Fix: permission helpers treat banned users as having no memberships. |
| 3 | Duplicate memberships accepted; "Esse acesso já existe." is dead code | medium | patch | memberships has no unique constraint. Fix: unique nulls not distinct (user_id, role, company_id, cost_center_id). |
| 4 | Malformed company/cost center id returns a raw English 500 | low | patch | optionalId accepts any string, so Postgres raises 22P02. Fix: UUID check with the pt-BR message. |
| 5 | getUserById error ignored, so a block can be wrongly refused | low | patch | The error is dropped. Fix: return 500 with the real message. |
| 6 | Integration test hard-deletes the users it creates | low | rejected | Throwaway accounts with no history; the "never delete" rule is about real users. Changing it would leave junk in every run. |
| 7 | Function's last-director refusal untested | false | rejected | Unreachable: the caller is always an active director other than the target, and self-blocking is tested. The DB rule is tested in pgTAP. |
| 8 | new.tsx and [id].tsx are not role-gated in the app | low | patch | Only index.tsx checks canEditMasterData. Fix: same guard in both. |
| 9 | must_change_password can be bypassed by a custom client | low | rejected | Needs a hand-crafted API call; a server-side flow is new surface. Recorded as a known limit in Implementation Notes. |

### Post-review verification

- Full Verification passed after the patches: typecheck, 46 unit tests, 39 pgTAP tests, db lint, 8 admin-users checks.
- Browser e2e (headless Edge, web): director creates a user, first login forces "Trocar senha", block shows "Usuário bloqueado." on login, manager has no "Usuários" entry and a direct link to the form is refused. No console errors. Throwaway accounts deleted.
