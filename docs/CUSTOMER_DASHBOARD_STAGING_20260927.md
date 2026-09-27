# Customer Dashboard staging migration incident — 2026-09-27

## Evidence and cause

- Target verified from both runtime and direct connections: `ep-royal-dust-axv3itmx.c-4.us-east-2.aws.neon.tech/neondb`, schema `public`, client TLS enabled. Root `.env` contains this operator-selected staging target. `.env.staging.*` targets a different Neon endpoint and was not used.
- Before: 25 successful migrations, one historical rolled-back attempt, exactly one pending migration: `20260927120000_cod_handover_manual_payout`. No attempt for that migration existed. `CODRemittance`, `CODPayout`, their enums, and `CODTransaction.version` were absent.
- Executing the Customer Dashboard's exact parameterized COD aggregation from `DashboardsService.overview()` in a read-only staging transaction failed with PostgreSQL **`42P01: relation "CODPayout" does not exist`**. The failing join is `LEFT JOIN "CODPayout" payout ON payout."codTransactionId" = cod.id`.
- This establishes a missing-schema failure in the dashboard query. The user-provided Render log only shows successful startup/Live at 13:10:28; it does **not** contain the original request's exception, query, or request ID. Do not describe the direct database reproduction as a captured Render exception.

## Applied action

- Used the repository's installed Prisma CLI with canonical **`prisma migrate deploy`**, explicitly binding `DIRECT_URL` to the verified target.
- Applied only `20260927120000_cod_handover_manual_payout`; no reset, manual DDL, migration-file edits, ledger repair, business-data writes, application patch, or backend restart/redeployment.
- Started `2026-09-27T13:21:40.614Z`, finished `2026-09-27T13:21:45.812Z`.
- SHA-256: `ed509b52a3253300115899fa06043c82ab1cb04c0243266e9b7b102657fe2fae`, matching the committed file and manifest.
- Fresh connection confirms **one row, one applied step, successful finish, no rollback** for this migration. After: 26 successful migrations, 27 total history rows including the pre-existing rollback, no pending migration. Canonical `prisma migrate status` reports **Database schema is up to date**.
- Verified both new tables, all 30 new-table columns, three integer/not-null/default-zero version columns, three enums, financial CHECK constraints, seven RESTRICT foreign keys, idempotency/payout unique indexes and both partial remittance unique indexes. CHECK constraints are validated.
- Original COD fields have an identical before/after fingerprint. Read-only comparisons also preserve the recorded Shipment, ShippingFeeTransaction and AuditLog fingerprints and all 26 pre-existing migration-history rows. No historical remittance or payout was fabricated.

## COD verification

The existing Customer has one legacy SETTLED COD transaction for 500,000 VND, with no remittance/payout child records. The actual dashboard SQL now succeeds. A separate row-by-row calculation matches all four totals:

| Metric | VND |
| --- | ---: |
| Collected | 500,000 |
| Unsettled | 0 |
| Awaiting payout | 500,000 |
| Paid out | 0 |

Legacy SETTLED means internally reconciled, not paid to the Customer. Its amount correctly remains awaiting payout.

## Deployment and remaining verification

- Local checkout and migration-introducing commit: `fb1de4ebb24fbaffe217b764d6f978bb14a79348`. **Render Live SHA is not supplied or independently accessible**, so exact deployed-commit comparison remains unverified.
- Post-migration readiness: **HTTP 200**, database/Redis up, `2026-09-27T13:26:35.418Z`, request `55aa66ce-1226-4620-bd80-0c18a8e2322d`.
- Authenticated Customer browser verification: **GET `/api/v1/dashboards/customer` HTTP 200**, request `5b759936-dda5-4b31-a7f5-ace45199a8b9`. All four rendered COD cards match the independent staging calculation above; the dashboard has two delivered shipments, no error UI and no observed page exception.
- Opened the existing delivered shipment through its real UI link: legacy COD API **HTTP 200**, request `b17863d8-35f5-4ec2-ad52-df95919f1601`, preserving `SETTLED` and `expectedAmount = 500000`.
- Returned to `/dashboard` through a fresh navigation and observed **HTTP 200** again. The user performed normal Customer login in the dedicated Chrome; no credential extraction, token fabrication, mocked API or auth bypass. Initial unauthenticated 401 is kept distinct from these authenticated successes.
- No restart/redeployment was necessary for recovery. Only the original Render exception/request correlation and exact Live SHA remain unavailable; no full deployment provenance claim is made.

## Existing history discrepancy

The H2/H3 successful rows retain the exact historical checksums documented in `RELEASE_ENGINEERING_I2.md`:

| Migration | Existing database SHA-256 | Repository SHA-256 |
| --- | --- | --- |
| H2 shipping fee reconciliation | `b2054fdfd41eb6a741d300c2627c92aeba5bfb316e51b01b0a317b338f0f4b3f` | `4c8b9dd70fbacfbc53be24045a62d67c3a8d59a882b4c77a8075704792b01adb` |
| H3 shipping fee online payment | `f6a01423c46b7bedfc9791ef81d5b530a702928b745e0f03015d180970458386` | `8324e237ba9afd159bb78dcda6a06cf75f238bdef221dac1c86eefe816a21228` |

This is the previously documented transaction-boundary repair discrepancy. The explicitly requested additive COD repair preserved these rows. The repository's strict canonical checksum gate **still fails** for those two historical migrations; Prisma's no-pending status is not an all-checksums-match claim. Neither the gate, manifest nor old SQL/history was changed.

## Artifacts and scope

Ignored local artifacts: `test-results/customer-dashboard-staging-{before,predeploy,after}.json`, guarded audit helper, `test-results/customer-dashboard-staging-browser.json`, and `test-results/customer-dashboard-staging.png`. Credentials, tokens and personal row values are excluded from JSON diagnostic output; the local screenshot shows the authenticated UI. Temporary audit files are not product code.

Invariants preserved: C04 ownership/RBAC, C05 history, C07 integer money, C08 historical data, C09/C10 idempotency and relational constraints, C16 backend authority. Validation used real staging read-only queries and canonical deploy/status; no mock-based test is presented as staging proof.
