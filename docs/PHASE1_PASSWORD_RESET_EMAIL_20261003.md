# Phase 1 password-reset email closure — 2026-10-03

**CI SMTP sandbox E2E: PASS (4/4). Staging email classification: UNKNOWN.** The user confirmed that staging delivery intent is unclear. No evidence in this task establishes whether the current Render backend intends real email, uses a sandbox, or disables delivery. This report does not accept a staging email waiver or classify the environment as an intentional limitation.

## Environment evidence

| Environment / source | Delivery flag | SMTP / provider | Intended delivery | Conclusion |
|---|---|---|---|---|
| Current staging / Render runtime | UNKNOWN | UNKNOWN | UNKNOWN, confirmed unclear by user | Config attestation and mailbox verification remain outstanding |
| Product configuration defaults | `EMAIL_DELIVERY_ENABLED=false` | Transporter created only when enabled; enabled mode requires host/user/password/from | Supports explicit enabled or disabled operation | A source default does not establish the Live value |
| Root local `.env` | Flag unset; development default is false | Some SMTP settings present | Development configuration | Does not attest staging; no credentials used for mail |
| Older local staging env files | Flag true in some files | Required SMTP settings incomplete | Not attested as current deployment config | Does not establish actual Live SMTP mode or intent |
| Dedicated Node 22/Linux CI suite | `EMAIL_DELIVERY_ENABLED=true` | Real Nodemailer **10.0.9**, authenticated SMTP on a test-owned `127.0.0.1` port | Private in-process sandbox mailbox; no forwarding | Full application email delivery boundary verified |

Relevant product boundaries: [environment validation](../backend/src/config/env.validation.ts), [SMTP sender](../backend/src/modules/notifications/email-sender.ts), [AuthController](../backend/src/modules/auth/auth.controller.ts), and [BullMQ jobs/worker](../backend/src/modules/notifications/notification-jobs.service.ts). This supersedes only the missing full SMTP CI coverage described in [the prior closure audit](PHASE1_RELEASE_CLOSURE_20261003.md#4-password-reset-email-staging); it does not supersede that audit's staging evidence gap.

## Observed verification

[password-reset-smtp.e2e-spec.ts](../backend/test/password-reset-smtp.e2e-spec.ts) uses the real Nest application, Prisma/PostgreSQL, Redis, BullMQ producer/worker, and Nodemailer adapter. No application providers, guards, API responses, or email adapters are mocked. [smtp-sandbox.ts](../backend/test/helpers/smtp-sandbox.ts) is a test-only SMTP server and owned mailbox supporting authentication, real MIME/envelope capture, and a controlled temporary SMTP rejection.

| Test case | Observed result |
|---|---|
| HTTP register/login establishes three sessions → HTTP forgot-password → real queue/worker → SMTP mailbox receives email | PASS; valid configured reset URL and recipient/sender; deterministic Message-ID and idempotency header |
| Email token matches stored SHA-256 hash → HTTP reset-password | PASS; database stores hash, email token is valid, successful queue job containing raw token is removed |
| After reset, all three old access/refresh sessions and old password are rejected | PASS; no active old sessions remain; new-password login and refresh succeed |
| Reuse the consumed token | PASS; HTTP 400 |
| Forgot-password for unknown account | PASS; response matches the observed known-account response and sends no mail |
| SMTP first DATA attempt rejected with 451 → BullMQ retries | PASS; second attempt accepted with the same Message-ID; normal HTTP reset and session revocation succeed |
| Sandbox-delivered token is expired in the guarded disposable fixture → HTTP reset | PASS; HTTP 400; existing session stays valid and can refresh |

The final Node 22/Linux canonical runner recorded **4/4 tests PASS**, with the expected one-time SMTP 451 failure followed by successful retry. Retained local diagnostics: `test-results/release-closure/linux-ci-verified.log`, suite `password-reset-smtp.e2e-spec.ts`. Whole-release totals and final runner status are in [the implementation report](PHASE1_RELEASE_CLOSURE_IMPLEMENTATION_20261003.md). An independent local smoke against the installed **Nodemailer 10.0.9** also passed authentication, long-link MIME decoding, headers, and temporary rejection/acceptance; that smoke used Node 24 and is not the Node 22 verification claim.

## Reproduction and scope

The suite is automatically discovered by [audit-e2e.mjs](../backend/scripts/audit-e2e.mjs) and therefore runs inside [deploy/ci/verify.sh](../deploy/ci/verify.sh) after migrations to the disposable test database. It requires PostgreSQL `127.0.0.1:55432/i1_*` and Redis `127.0.0.1:56379`; any other target fails before starting the SMTP sandbox. It uses a dedicated Redis database `/3`. Enabled SMTP settings and the ephemeral mailbox port are supplied only in the isolated test process before the application configuration loads. Actual application throttling remains enabled.

The test only creates and cleans up its UUID-scoped disposable auth fixtures. Expiration is changed only for a disposable test token. No staging forgot/reset request or email send, staging migration/reset, historical checksum update, or deployment occurs. No dependency was added for the sandbox. No public/debug token endpoint was added. Captured email and extracted tokens stay in the test process; the existing delivery path also carries the raw token in a short-lived disposable BullMQ job, verified removed on completion. Test diagnostics do not export mailbox content, token, password, provider credentials, or environment dumps.

This proves the full controlled HTTP → PostgreSQL → Redis/BullMQ → SMTP → HTTP-reset flow and revocation behavior. It does not prove staging SMTP authentication/network/TLS, provider/sender approval, delivery to an actual staging mailbox, or current Live configuration. Closing staging email evidence requires sanitized runtime config/intent attestation and, if real delivery is intended, an owned real/sandbox mailbox test through the normal forgot/reset endpoints. If the operator instead attests intentional disabled/sandbox staging, document that limitation explicitly and assess it against the release policy with this CI evidence; UNKNOWN is not such an attestation.
