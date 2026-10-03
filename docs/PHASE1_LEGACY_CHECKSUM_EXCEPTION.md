# H2/H3 controlled legacy checksum exception

Implemented for the explicit Phase 1 release-closure request dated 2026-10-03 (Asia/Saigon). The exception recognizes two proven historical SQL hashes on the previously audited staging database. It does not change migration SQL, the canonical manifest, applied checksums or any other database row.

## Scope and exact identities

The exception is disabled by default. The operator must pass `--legacy-staging-h2-h3` to the read-only migration gate or staging preflight. Its only accepted direct target is `ep-royal-dust-axv3itmx.c-4.us-east-2.aws.neon.tech:5432/neondb`; the URL must require `sslmode=verify-full`, the connected database must be `neondb`, and the TLS certificate must be authorized. The pooled runtime connection is accepted by staging preflight only after its existing topology checks establish that it targets that same direct database. Shadow databases and disposable CI databases use strict checksum matching.

| Migration | Historical applied SHA-256 | Expected current SQL/manifest SHA-256 |
|---|---|---|
| `20260907170000_phase_h2_shipping_fee_reconciliation` | `b2054fdfd41eb6a741d300c2627c92aeba5bfb316e51b01b0a317b338f0f4b3f` | `4c8b9dd70fbacfbc53be24045a62d67c3a8d59a882b4c77a8075704792b01adb` |
| `20260907210000_phase_h3_shipping_fee_online_payment` | `f6a01423c46b7bedfc9791ef81d5b530a702928b745e0f03015d180970458386` | `8324e237ba9afd159bb78dcda6a06cf75f238bdef221dac1c86eefe816a21228` |

Each historical hash is associated with exactly its migration ID and exactly its known current canonical hash. A canonical row still passes normally. A recognized historical row is reported as `PASS_WITH_LEGACY_EXCEPTION`, with its migration ID, rather than being described as a checksum match. Different hashes, exchanged H2/H3 hashes, edited canonical files/manifest, other migration IDs and different targets fail. Any subsequent canonical change invalidates the exception; expanding it requires a separately reviewed policy change. New migrations remain strict.

Both entry points validate actual current SQL bytes and `migration_lock.toml` against the canonical manifest before examining database history. The existing Git baseline guard, unknown-row, unresolved-failure, duplicate-success, canonical-prefix and pending-migration rules remain in force. The release CI invocation does not enable the exception and continues to apply and validate canonical SQL in disposable databases.

## Reason and provenance

The original migrations were applied before the I1 repair added an opening explanatory comment, `BEGIN;`, and the first `COMMIT;`, so newly added PostgreSQL enum values commit before later CHECK constraints use them. The remaining SQL is unchanged. The existing I1/I2 reports record that repair on 2026-09-09. On 2026-10-03, byte reconstruction performed only in memory reproduced both historical ledger hashes exactly, without newline normalization or statement edits. Regression tests repeat this proof from the actual canonical SQL files: H2 is 5,431 bytes; H3 is 8,064 bytes.

The read-only staging audit at `2026-10-03T01:14:20.788Z` observed 26 successful migrations and one previously rolled-back Phase 5 row. H2 started at `2026-09-07T02:59:13.018Z`, finished at `2026-09-07T02:59:17.727Z`; H3 started at `2026-09-07T04:33:35.222Z`, finished at `2026-09-07T04:33:40.694Z`. Both recorded one applied step. The audit verified TLS and used read-only transactions. Its complete evidence and limitations are in [the release closure audit](PHASE1_RELEASE_CLOSURE_20261003.md#2-h2h3-checksum-history).

Current reachable Git history begins with snapshot `91360bd0aefa416da18bd33c543e83ea0cb766f5`, authored `2026-09-11T10:44:17+07:00`, which already contains the repaired SQL. No original-at-apply commit or distinct modifying commit survives in the available Git graph. The historical SQL is therefore a reconstruction verified against the applied ledger, not a recovered original Git artifact. The explicit release-closure task authorizes this limited exception while retaining that provenance limitation.

The existing read-only schema diff at `2026-10-02T05:33:43.793Z` reported no Prisma schema difference; canonical fresh migration replay and operational tests had passed. That earlier result is not a new live verification and does not by itself verify every custom CHECK/index predicate or every data invariant. The exception recognizes documented historical identity; it is not a schema/data integrity bypass. Current test and any fresh staging read-only verification results belong in the final release-closure report.

## Verification and use

Run `node --test backend/scripts/migration-integrity.test.mjs`. Coverage includes exact H2/H3 legacy pairs, each wrong historical hash, each changed canonical hash, swapped/reused hashes, strict new-migration drift, different target/TLS, canonical source bytes, reconstruction evidence and every existing history guard.

Run `node backend/scripts/migration-integrity.mjs` for strict canonical files and the existing optional trusted Git baseline. For a read-only legacy staging check, supply `DIRECT_URL` privately and run `node backend/scripts/migration-integrity.mjs --database --legacy-staging-h2-h3`. For the existing topology/TLS/shadow preflight, run `node backend/scripts/staging-preflight.mjs <private-staging-env-file> --legacy-staging-h2-h3`.

These tools use SELECT and read-only transactions followed by ROLLBACK. They never update `_prisma_migrations`, resolve/reapply migrations, reset a database or deploy an application. Removing the explicit flag restores strict applied-checksum comparison immediately.
