# COD handover and manual payout — 2026-09-27

Implemented locally. Staging **BLOCKED / NOT DEPLOYED**: the new schema and application contract have not been rolled out or authenticated on staging. No production migration or external money transfer was executed.

## Change and scope

Previously Driver remit changed COD directly from COLLECTED to REMITTED. Now the collecting Driver submits a CODRemittance, and only Admin confirmation after receiving money commits REMITTED. Rejection preserves COLLECTED and the rejected history. The canonical COD lifecycle remains `PENDING → COLLECTED → REMITTED → SETTLED`.

SETTLED means internal reconciliation. A separate CODPayout records the full COD amount: Admin creates PENDING with a reference, explicitly records SENT, then the owning Customer confirms PAID_OUT or reports DISPUTED. The API never moves bank funds. ShippingFeeTransaction, its amount, lifecycle and service are unchanged; COD is never netted against shipping fees.

Canonical business and UI contracts: [DOMAIN.md](DOMAIN.md#cod), [UI.md](UI.md#cod-handover--manual-payout-2026-09-27).

## Schema and migration

- `backend/prisma/schema.prisma`: CODRemittance, CODPayout, their enums/relations; CODTransaction.version.
- `20260927120000_cod_handover_manual_payout/migration.sql`: additive tables/column, integer amounts, foreign keys with RESTRICT deletion, state/evidence CHECK constraints.
- Unique remittance `(codTransactionId, clientRequestId)`, partial unique one PENDING and one CONFIRMED; unique payout codTransactionId. Rejected submissions remain available as history.
- Manifest appends SHA-256 `ed509b52a3253300115899fa06043c82ab1cb04c0243266e9b7b102657fe2fae`. All 26 migration files pass checksum verification against Git HEAD; existing migration bytes are unchanged.
- Historical REMITTED/SETTLED rows remain untouched. No fabricated remittance confirmation, recipient acknowledgment or payout is backfilled.

Deploy the additive migration through the existing controlled migration process before the backend/frontend release. The previous remit payload without clientRequestId now fails validation; an old client cannot bypass company confirmation.

## Commands, authorization and retry

All paths below are under `/api/v1/cod`.

| Command | Allowed actor | Input / result |
|---|---|---|
| `POST shipments/:shipmentId/remit` | Collecting Driver | amount, clientRequestId, note? → remittance PENDING; COD stays COLLECTED |
| `POST remittances/:id/confirm` | Admin | expectedVersion → CONFIRMED + COD REMITTED |
| `POST remittances/:id/reject` | Admin | expectedVersion, reason → REJECTED; COD stays COLLECTED |
| `POST :id/settle` | Admin | Matching collected/remitted/expected amounts → COD SETTLED |
| `POST :id/payout` | Admin | amount, BANK_TRANSFER/CASH, reference, note? → payout PENDING for Shipment owner |
| `POST payouts/:id/send` | Admin | expectedVersion, matching reference → SENT, actor/time recorded |
| `POST payouts/:id/confirm` | Owning Customer | expectedVersion → PAID_OUT + acknowledgment timestamp |
| `POST payouts/:id/dispute` | Owning Customer | expectedVersion, reason → DISPUTED; no acknowledgment timestamp |
| `GET shipments/:id` | Owning Customer | Live financial state/timeline/reference; internal notes and staff identities omitted |

Commands validate roles in the service as well as route guards. Customer commands check both the payout customer and Shipment owner. Unauthorized resource access returns 404. Amounts must equal collected and expected COD; sending also requires the immutable payout reference. Client-controlled status/actor/customer fields are rejected by whitelist validation.

Every mutation locks the parent COD row in a PostgreSQL transaction before re-reading mutable child state, uses conditional status/version updates, and writes AuditLog in that transaction. Exact retries return the committed row without a new transition/audit. A reused remittance request ID returns the original submission, even after rejection; a fresh rejected-handover attempt requires a new ID. Conflicting payloads/versions/opposite decisions return 409. A send retry after Customer acknowledgment returns the latest payout without reopening it. Payout create retries match actor, amount, method, reference and note against the unique row.

Enforced invariants: C01/C02 backend command authority; C04 ownership/RBAC; C05/C06 append-only business history and private audit; C07 integer money; C08 historical data; C09/C10 retry/concurrency; C14/C15 thin controllers and explicit DTOs; C16 canonical money validation; C18 tests.

## User experience and dashboard

Driver sees amount, confirmation modal, waiting-for-company text and rejected handover reason/history. Admin sees Driver/Customer names, confirms/rejects handover, reconciles internally, creates payout with transfer/receipt reference and records sending. Customer sees the financial timeline, method/reference and a separate receipt or problem confirmation dialog. There is no Admin receipt acknowledgment action.

All financial state is read from the backend; no optimistic financial success. Loading disables duplicate clicks, server errors remain in the modal, and successful mutations refetch queries. Open views refresh every 30 seconds and survive reload. Shared components provide mobile cards, desktop table scrolling, labeled forms and keyboard-operable dialogs.

Customer totals are aggregated in PostgreSQL with a unique 1:1 payout join:

| Stage (500,000 VND example) | Collected | Unsettled | Awaiting payout | Paid out |
|---|---:|---:|---:|---:|
| Delivery / handover pending / REMITTED | 500,000 | 500,000 | 0 | 0 |
| SETTLED / payout PENDING / SENT | 500,000 | 0 | 500,000 | 0 |
| Customer confirms PAID_OUT | 500,000 | 0 | 0 | 500,000 |
| Customer reports DISPUTED | 500,000 | 0 | 500,000 | 0 |

## Verification

| Check | Result / scope |
|---|---|
| Backend unit suite | **PASS 433/433**, 54 suites |
| Frontend unit suite | **PASS 64/64** |
| PostgreSQL + Nest HTTP E2E | **PASS 6/6** in isolated localhost DB `cod_location_1790513610730`; 26 SQL migrations replayed |
| Browser production components | **PASS** 375×812, 812×375, 768×1024, 1440×900 |
| Workspace lint / typecheck / backend and frontend builds | **PASS** |
| Canonical migration checksums + Git baseline | **PASS 26**, no historical migration changes |
| Staging | **BLOCKED / NOT DEPLOYED**, authenticated business smoke not run |

E2E covers actual delivery collection/retry, collecting Driver ownership, Driver self-confirm prohibition, pending handover preserving COD, wrong amount, duplicate and concurrent requests, Admin review, settlement, payout before SETTLED, duplicate payout and conflicting reference, missing reference, invalid amounts/DTO fields, stale versions, Customer confirmation before SENT, Admin impersonation prohibition, wrong Customer reads/writes, safe response fields, received/disputed totals, rejected history/resubmission, reload/live reads, SQL unique constraints and unchanged ShippingFeeTransaction. Competing confirm/reject and receive/dispute commands commit exactly one terminal outcome/audit. One existing coordinate-persistence regression is retained in the same six-test suite.

The HTTP E2E uses real PostgreSQL, Nest guards, validation, service transactions and queries; Redis is mocked. Browser checks use the production React components with intercepted HTTP fixtures, verify error/retry/rejection/history/payout/dispute/reload/amounts and page width, and do not establish staging or bank-transfer evidence. Windows sandbox EPERM for child processes/Docker was resolved through approved escalation. The existing map chunk size warning remains informational.

Commands: `npm run test --workspace backend`, `npm run test --workspace frontend`, `node backend/test/cod-location-local.mjs`, `node frontend/test/cod-ux.mjs`, `npm run lint`, `npm run typecheck`, `npm run build`, `node backend/scripts/migration-integrity.mjs` with MIGRATION_BASE_REF set to Git HEAD.

## MVP limits

- References are manual evidence declared by Admin; there is no bank provider or automatic verification of cash movement.
- No active document StorageService/upload boundary exists in the repo. Proof-file upload is deferred; arbitrary proof URLs are not accepted.
- DISPUTED remains unpaid and requires operational investigation; resolution/resend/refund commands are outside this MVP. No second payout can be created.
- Payout method/reference are immutable after creation. A correction/cancellation workflow is a future explicit command, not a generic edit.
- Admin/Driver lists retain the existing 100 most recent records limit; summaries cover their whole authorized scope.

Implementation files: Prisma schema/migration/manifest; `backend/src/modules/cod/`, dashboard service/response, Phase 7 E2E; `frontend/src/features/cod/`, dashboard types/grid/copy, Shipment Detail, shared badge configuration, COD browser regression; DOMAIN/UI/PROJECT_STATE and this report.
