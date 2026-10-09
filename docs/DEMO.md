# Local demo guide

Use the [README setup](../README.md#run-locally) with a new `logistics-demo-postgres` container, database `logistics_demo`, loopback port 55433, email disabled and no real personal/payment data. This guide creates local demonstration records only. It is not a staging seed/reset procedure.

## First Admin

Public registration always creates a Customer. There is no public Admin-registration or automatic Admin-seed endpoint.

1. Start the local app and register the **first and only account** as `demo-admin@example.test`, choosing your own password (12–128 characters). Do not create a shipment yet.
2. Log out. Open the explicitly named local container console:

   ```sh
   docker exec -it logistics-demo-postgres psql -U demo -d logistics_demo
   ```

3. Paste this one-time transaction. It refuses another DB name, an existing Admin, additional users or existing shipments, revokes the bootstrap session and records an audit entry. It does not set or expose a password hash.

   ```sql
   \set ON_ERROR_STOP on
   BEGIN;
   DO $bootstrap$
   DECLARE demo_user_id uuid;
   BEGIN
     IF current_database() <> 'logistics_demo'
        OR (SELECT count(*) FROM "User") <> 1
        OR EXISTS (SELECT 1 FROM "User" WHERE role = 'ADMIN')
        OR EXISTS (SELECT 1 FROM "Shipment") THEN
       RAISE EXCEPTION 'Only a fresh local logistics_demo database is eligible';
     END IF;
     SELECT id INTO STRICT demo_user_id FROM "User"
       WHERE email = 'demo-admin@example.test' AND role = 'CUSTOMER' AND status = 'ACTIVE';
     UPDATE "User" SET role = 'ADMIN', "tokenVersion" = "tokenVersion" + 1,
       "updatedAt" = now() WHERE id = demo_user_id;
     UPDATE "AuthSession" SET "revokedAt" = now()
       WHERE "userId" = demo_user_id AND "revokedAt" IS NULL;
     INSERT INTO "AuditLog"
       (id, "actorId", "actorRole", action, "entityType", "entityId", before, after)
       VALUES (gen_random_uuid(), demo_user_id, 'ADMIN', 'LOCAL_DEMO_ADMIN_BOOTSTRAP',
         'User', demo_user_id::text, '{"role":"CUSTOMER"}', '{"role":"ADMIN"}');
   END;
   $bootstrap$;
   COMMIT;
   ```

4. Exit with `\q`, sign in again and confirm `/admin/dashboard`. For subsequent Admin accounts use the normal staff-creation UI. Do not adapt this console bootstrap to shared environments.

## Accounts and operational setup

Use separate browser profiles for roles so session cookies do not collide. Example email addresses below are labels, not provisioned credentials. Choose separate passwords, keep them outside Git and never publish them in screenshots.

| Account | Create through | Required operational configuration |
| --- | --- | --- |
| Admin: `demo-admin@example.test` | One-time local procedure above | Manage remaining resources |
| Customer: `demo-customer@example.test` | `/register` | Sender/recipient demo addresses |
| Dispatcher: `demo-dispatcher@example.test` | Admin → Create staff, role `DISPATCHER` | No driver/warehouse-staff profile |
| Origin/destination staff: `demo-origin@example.test`, `demo-destination@example.test` | Admin → Create staff, role `WAREHOUSE_STAFF` | Assign each user to its warehouse with a unique staff code |
| Pickup/delivery/line-haul drivers: `demo-pickup@example.test`, `demo-delivery@example.test`, `demo-linehaul@example.test` | Admin → Create staff, role `DRIVER` | Driver profile, operating warehouse, capability and online availability |

Staff must change their temporary password at first login. Create staff at `/admin/staff/new` (API: `POST /api/v1/users/staff`, fields `email`, `fullName`, `role`, `temporaryPassword`; optional `phone`). Creating a DRIVER or WAREHOUSE_STAFF user alone does not grant an operational profile.

Prepare resources in this order:

1. **Warehouses:** Admin `/admin/warehouses`, create two active warehouses, e.g. `DEMO_ORIGIN` and `DEMO_DESTINATION`, with valid addresses and coordinates. Assign each staff account (`POST /warehouses/:id/staff`, `{userId, staffCode}`). Use IDs returned by the API/UI; never paste IDs from a report.
2. **Drivers:** Admin `/admin/drivers`, create profiles with `userId`, `operatingWarehouseId`, unique `employeeCode`, `vehicleType`, `vehiclePlate`. Pickup/line-haul operate from origin; delivery operates from destination. Set capabilities using the UI or `PATCH /drivers/:id/capabilities` with `{capabilities: ["PICKUP"]}`, `["DELIVERY"]` or `["LINE_HAUL"]`. Each driver signs in, changes password and goes online. Use the eligible-candidate lists when assigning work.
3. **Fleet:** Admin `/admin/line-haul/vehicles`, create an AVAILABLE vehicle with a unique plate/code and capacity greater than the demo parcel weight (`capacityWeightGrams`). This fleet record is separate from the driver's descriptive vehicle fields.
4. **Pricing:** Admin `/admin/pricing`, inspect/publish a demo pricing version before quoting. Example configurable inputs: base fee 30000 VND, included weight 1000g, extra 5000 VND/kg, COD fee 50 basis points. These are demo inputs, not hardcoded system tariffs.
5. **Strict mode:** Before creating transfers, verify the local fixed UTC `LINE_HAUL_ENFORCEMENT_FROM` has been reached and the API was restarted after configuration. Keep providers disabled. Route fallback has no fabricated road ETA; it does not remove schedule/capacity checks.

API paths in this guide omit the `/api/v1` prefix. Use local [Swagger](http://localhost:3000/api/docs) for exact DTO requirements. A 403/409 should be investigated through scope, eligibility, current status and version, not bypassed with SQL.

## Shipment → Warehouse → Line-haul → Delivery → COD

Allow about 15–20 minutes after resources are ready. Keep the tracking code, shipment ID, transfer ID, trip ID and ledger IDs in your private demo notes.

| Step / actor | Action | Evidence to show |
| --- | --- | --- |
| 1. Customer | Create a small parcel, e.g. 1000g with COD 100000 VND, valid sender/recipient details and intended route. Choose sender-paid cash shipping fee for this walkthrough. | Server quote, fee snapshot, tracking code, `PENDING` |
| 2. Dispatcher | Confirm the shipment; assign an eligible pickup driver from the correct operating warehouse. | `AWAITING_PICKUP_ASSIGNMENT` then `PICKUP_ASSIGNED`, assignment history |
| 3. Pickup driver | Accept, complete pickup and record proof details. Collect the **exact quoted shipping fee** when the form requires it. | `PICKUP_IN_PROGRESS` then `PICKED_UP`; shipping fee is separate from COD |
| 4. Origin staff | Check in the picked-up shipment. Set/confirm the destination warehouse through the routing command; create a pending transfer to that destination. | Current warehouse, `AT_ORIGIN_WAREHOUSE`, pending transfer code |
| 5. Dispatcher | Create a matching-route Trip, select eligible line-haul driver/vehicle, add the pending transfer to its manifest, reserve a current non-overlapping schedule window, then prepare READY. | Manifest, reserved resources, total weight/capacity, `PLANNED → READY` |
| 6. Dispatcher/Admin | Dispatch the READY Trip. | Trip, transfer and shipment move to `IN_TRANSIT` atomically; strict standalone transfer dispatch remains blocked |
| 7. Destination staff | Confirm **Trip arrival**, then receive the transfer in the incoming queue. | Trip `ARRIVED`, transfer `COMPLETED`, shipment `AT_DESTINATION_WAREHOUSE` |
| 8. Destination staff / Dispatcher | Mark ready for delivery, then assign the destination delivery driver. | `AWAITING_DELIVERY_ASSIGNMENT → DELIVERY_ASSIGNED` |
| 9. Delivery driver | Start delivery and complete with receiver/proof details; collect the displayed COD. | `OUT_FOR_DELIVERY → DELIVERED`, delivery attempt and COD `COLLECTED` |
| 10. Delivery driver / Admin | Driver submits COD remittance; Admin confirms the actual amount/reference and settles through the available ledger actions. | Remittance and transaction history, COD `REMITTED → SETTLED` |
| 11. Admin / Customer | Admin creates a CASH demo payout, records it as sent; Customer acknowledges receipt. | Payout `PENDING → SENT → PAID_OUT`, owner checks and immutable history |

Trip APIs: create `/line-haul/trips`, add `/:id/transfers`, `/:id/schedule` with `expectedVersion` and UTC start/end, `/:id/prepare`, `/:id/dispatch`, `/:id/arrive`. Refetch after a version conflict. Reuse `clientRequestId` for a retry of the same create request. Arrival does not automatically receive every shipment; each transfer receipt remains a warehouse command.

COD APIs: driver `/cod/shipments/:shipmentId/remit`, Admin `/cod/remittances/:id/confirm`, `/cod/:id/settle`, `/cod/:id/payout`, `/cod/payouts/:id/send`, Customer `/cod/payouts/:id/confirm`. Versioned DTOs use the current response version. Use a local note/reference such as a demo receipt; these actions record cash movement and do not execute an external payment. Remit/settle the pickup driver's shipping-fee collection separately in the shipping-fee workspace.

Optional failure branch: on a **separate demo shipment**, record a delivery failure, then show Dispatcher redelivery or request return → owning Driver start return → warehouse receive return. Preserve previous attempts; never manually rewrite status/history.

## Control Tower, refresh and notifications

- Open `/admin/control-tower` or `/dispatcher/control-tower` while the shipment/trip is active. Show server snapshot time, role scope, search/status/stage/SLA filters, paging and sorting.
- Click exact Shipment, Transfer and Trip rows; reload with F5 and confirm the same entity detail. Open a notification from the bell/center and verify the intended route. Reload an authenticated nested route, then log out and verify it no longer exposes protected data.
- Explain ON_TIME/AT_RISK/OVERDUE and aging from the [policy](CONTROL_TOWER_SLA_AGING_20261006.md). New demo data may have no overdue rows. Use the existing test results for boundary cases; do not backdate shared records or label fixtures as live evidence.
- F07: show incoming/outgoing search and pagination totals. The 101st-record demonstration belongs to the existing disposable regression fixture (`npm run test:browser:regression`), unless the local demo already contains that volume. Do not seed staging just to fill pages.

## Screenshots and demo recording

Capture a short 3–5 minute walkthrough or these screenshots at 1440px and one warehouse/mobile view at 375px:

| Suggested filename | Content |
| --- | --- |
| `01-control-tower.png` | Filters, SLA/aging and snapshot time |
| `02-shipment-timeline.png` | One shipment's real command history |
| `03-warehouse-transfer.png` | Incoming/outgoing pagination and exact transfer |
| `04-linehaul-manifest.png` | Trip schedule, manifest, capacity and READY/arrival state |
| `05-driver-delivery.png` | Driver-owned delivery/proof result |
| `06-cod-ledger.png` | Collection, remittance and acknowledged payout |

Save reviewed images under `docs/screenshots/` if publishing a portfolio gallery; add links only after files exist. Remove real names, phone/address details, tokens, passwords, banking information and developer-console secrets. Caption each image with commit/date, role and **local demo** or **HTTP fixture**. Test output lives in ignored `test-results/` / `playwright-report/`; it is not automatically a public gallery. No screenshot or recording is claimed as captured by this documentation task.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No eligible driver | Active user/profile, password changed, correct warehouse/capability, online state and competing assignments/reservations |
| Cannot prepare/dispatch Trip | Pending manifest route, active resources, capacity, valid schedule window and current version |
| Cannot receive transfer | Destination ownership, Trip ARRIVED, transfer IN_TRANSIT and current shipment state |
| No email | Local `EMAIL_DELIVERY_ENABLED=false` is intentional; in-app notification evidence is separate |
| Quote unavailable / wrong fee | Active pricing version, integer units and the stored shipment quote |
| Restore login/F5 fails | Consistent localhost origins/cookies, API/Redis readiness and current account status |
| E2E rejects demo DB | Expected safety guard; use a separate disposable test DB/environment |

For release evidence and pending hosted/staging checks, see [closure](FINAL_PROJECT_CLOSURE_20261009.md). For backup drills, see [backup/restore](BACKUP_RESTORE.md).
