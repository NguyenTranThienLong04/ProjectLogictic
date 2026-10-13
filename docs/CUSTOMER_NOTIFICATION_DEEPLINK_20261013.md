# Customer notification deep-link — 2026-10-13

**CUSTOMER NOTIFICATION DEEP-LINK: PASS (local verification).** Scope: Customer notification navigation only. No migration/reset/seed, deployment, dependency change or backend business-code change.

## Diagnosis before repair

Two independent frontend causes:

1. `notificationTarget()` returned `undefined` for every role except Driver. Bell clicks called `useOpenNotification`, which marked the notification read and closed the dropdown, but had no target to navigate to.
2. All Notifications rendered a clickable title only for `user.role === 'DRIVER'`. Customer titles were plain text, so fixing the resolver alone could not fix this entry point.

Reproduction: the new resolver suite failed 13/14 tests before the fix (all eleven Customer types and two fallback cases). After fixing only the resolver, the actual-App browser test passed the Customer dropdown matrix at 375px, then failed to find a clickable `Customer SHIPMENT_CREATED` title in All Notifications. Both issues were diagnosed and reproduced before their respective repairs.

Backend metadata issue: **NO**. Frontend resolver issue: **YES**, plus the Notification Center title condition. The shared open hook already starts mark-read independently of navigation and required no edit.

## Full flow and metadata audit

All current notification writes enter `NotificationsService.createIdempotent()`; it stores `type` and `data` unchanged. Producers select the audience with `Notification.userId`, using the owning `Shipment.customerId` (or authenticated Customer ID during shipment creation). They do not supply an independent `role`/`audience` JSON field. Role for navigation comes from the authenticated frontend user, never notification metadata.

Every current Customer notification below targets **`/shipments/:shipmentId`**. This is the existing route in `frontend/src/app/role-routes/customer-routes.tsx`; `/customer/shipments/:id` does not exist.

| Notification type | Producer | Persisted data | Expected target |
|---|---|---|---|
| `SHIPMENT_CREATED` | `shipments.service.ts`, create | `shipmentId`, `trackingCode` | Shipment detail |
| `SHIPMENT_CONFIRMED` | `assignments.service.ts`, confirm | `shipmentId`, `trackingCode` | Shipment detail |
| `PICKUP_DRIVER_ASSIGNED` | `assignments.service.ts`, assign/reassign | `shipmentId`, `assignmentId` | Shipment detail |
| `PICKUP_IN_PROGRESS` | `assignments.service.ts`, accept pickup | `shipmentId`, `assignmentId` | Shipment detail |
| `SHIPMENT_PICKED_UP` | `assignments.service.ts`, complete pickup | `shipmentId`, `assignmentId` | Shipment detail |
| `WAREHOUSE_ARRIVED` | `warehouses.service.ts` origin check-in; `warehouse-transfer-lifecycle.service.ts` destination receive | `shipmentId`, `warehouseId` | Shipment detail |
| `DELIVERY_DRIVER_ASSIGNED` | `delivery.service.ts`, assign delivery | `shipmentId`, `assignmentId` | Shipment detail |
| `OUT_FOR_DELIVERY` | `delivery.service.ts`, start delivery | `shipmentId`, `assignmentId` | Shipment detail |
| `DELIVERED` | `delivery.service.ts`, complete delivery | `shipmentId`, `attemptId` | Shipment detail |
| `DELIVERY_FAILED` | `delivery.service.ts`, fail delivery | `shipmentId`, `attemptId`, `reason` | Shipment detail |
| `RETURN_STARTED` | `delivery.service.ts`, start return | `shipmentId` | Shipment detail |

No current COD payout/remittance/customer-confirmation, shipping-fee payment or quote notification producer exists. No corresponding notification metadata IDs or targets were invented. Customer COD and payment controls live within shipment detail; the existing payment return route `/payments/result` is not a notification target. `SHIPMENT_CANCELLED` and `PICKUP_DRIVER_REASSIGNED` are tracking event types, not separate Customer notification types. Pickup reassignment still emits `PICKUP_DRIVER_ASSIGNED`.

Other audiences: `PICKUP_ASSIGNMENT_CREATED` and `DELIVERY_ASSIGNMENT_CREATED` go to the assigned Driver; `PICKUP_ASSIGNMENT_REJECTED` goes to active Dispatchers. These are not Customer notification producers.

Trace after repair:

1. Producer → idempotent notification row with metadata above.
2. `GET /api/v1/notifications` → controller passes authenticated `user.id`; service filters `userId` and returns rows without dropping metadata, inside the normal API envelope. Socket `notification.created` also retains `type`/`data`; the bell invalidates and refetches the notification API.
3. `notification-api.ts` unwraps `response.data.data` → both entry points share `useOpenNotification`.
4. `notification-target.ts` recognizes the eleven Customer types and validates `data.shipmentId` as a UUID. Assignment/warehouse/attempt IDs are never substituted for shipment IDs. Missing/invalid metadata and unknown types fall back to `/shipments`; arbitrary URLs and embedded roles are ignored.
5. `useOpenNotification` starts mark-read, closes the dropdown if applicable, and navigates without waiting. The existing mutation-cache error feedback remains visible at the destination on failure. Already-read notifications navigate without another PATCH.
6. Authenticated role router loads Customer routes → `/shipments/:id` matches `ShipmentDetailPage` → `useParams().id` → `getShipment(id)` → `GET /api/v1/shipments/:id`.
7. The controller requires Customer role. `ShipmentsService.getOwned()` checks `{ id: shipmentId, customerId: authenticatedUser.id }` before accessing the detail cache. A non-owner receives `404 SHIPMENT_NOT_FOUND`; other roles receive 403. F5 restores the session and reloads detail from the URL.

## Fix and invariants

Only two production files changed: add the Customer branch in the shared resolver; render the Notification Center title as a button when that same resolver has a target. There is one source of route-selection policy. Driver resolver branches and `useOpenNotification` are unchanged.

Broken interaction contract: an available Customer notification did not open its existing durable detail route. No persisted shipment lifecycle or ownership invariant was broken. C01 remains backend-authoritative; C04 role/resource ownership is enforced by the existing API; C11 reload reads API state instead of treating Socket/browser state as authority.

## Verification

| Required check | Result / evidence |
|---|---|
| Customer bell dropdown | **PASS** — all 11 types at 375px and 1440px |
| Customer All Notifications | **PASS** — all 11 types at 375px and 1440px |
| F5 at target | **PASS** — all 11 types from both entry points; same URL, fresh auth restore and exact shipment detail GET |
| Mark-read pending / failure | **PASS** — held-open PATCH and 503 each allow navigation and detail rendering from both entry points; failure feedback visible |
| Already read | **PASS** — navigates with no additional PATCH |
| Missing / malformed metadata | **PASS** — null, empty, assignment-only, path injection and unknown type return to Customer `/shipments` |
| Ownership violation | **PASS** — real Nest controller/service/JWT/role guards return 404 before cache; browser handles rejected detail and F5 without showing private detail |
| Driver Pickup and Delivery | **PASS** — unchanged actual-App dropdown/center → assignment URL → F5/detail tests at 375px, 768px, 1440px; resolver fallback tests retained |
| Admin / Dispatcher | **PASS** — baseline behavior preserved: dropdown marks read without navigation, center retains plain title and explicit mark-read action |
| Migration required | **NO** |

Commands/results:

- `node --experimental-strip-types --test frontend/test/*.test.mjs`: **86/86 PASS** (including 14 new Customer/role tests).
- `npm run test --workspace backend -- --runTestsByPath src/modules/notifications/customer-notification-http.spec.ts src/modules/notifications/notifications.service.spec.ts src/modules/shipments/shipments.service.spec.ts`: **18/18 PASS**, three suites, including five new HTTP tests.
- `node frontend/test/ui-flow/notification-reload.mjs`: **PASS** for the full Customer, Admin/Dispatcher and existing Driver matrix. The existing browser regression runner already invokes this script.
- Workspace typecheck, frontend production build, frontend lint: **PASS**. Backend full lint found only formatting/type-assertion issues in the new test; after correcting them, scoped ESLint on that file: **PASS**. `git diff --check`: **PASS**.

Verification limits: Windows/local Node 24.13.1; repository CI targets Node 22 and was not run remotely. Browser tests use the production-built App with intercepted HTTP, and HTTP tests use real Nest controllers/services/guards with repository/cache fixtures. These establish local routing and authorization-boundary regression coverage, not fresh PostgreSQL or staging evidence. No database was migrated, reset or seeded. Production build emitted the existing unknown-release-SHA/large-chunk warnings; this task did not prepare a release artifact for deployment.

## Files changed

- `frontend/src/features/notifications/notification-target.ts`
- `frontend/src/features/notifications/notifications-page.tsx`
- `frontend/test/customer-notification.test.mjs`
- `frontend/test/ui-flow.test.mjs`
- `frontend/test/ui-flow/customer-notification-fixtures.mjs`
- `frontend/test/ui-flow/customer-notification-check.mjs`
- `frontend/test/ui-flow/notification-reload.mjs`
- `backend/src/modules/notifications/customer-notification-http.spec.ts`
- `docs/CUSTOMER_NOTIFICATION_DEEPLINK_20261013.md`
- `PROJECT_STATE.md` (short entry only; pre-existing edits preserved)
