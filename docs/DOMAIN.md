# Domain reference

Current implementation reference for the [README](../README.md) and [demo](DEMO.md). Business authority remains the backend policies/services and [constitution](CONSTITUTION.md); this document does not introduce transitions.

## Entities and ownership

| Entity | Purpose / owner |
| --- | --- |
| Shipment | Customer-owned booking, integer-VND quote snapshot, current status/version and warehouse location |
| DriverAssignment | Pickup/delivery ownership and append-only assignment history; driver profile/capability/service area must be eligible |
| WarehouseTransfer | One shipment moving between exact origin/destination warehouses; active transfer conflicts are rejected |
| LineHaulTrip / TripTransfer | Driver, vehicle, reserved schedule and transfer manifest; membership removal preserves history |
| DeliveryAttempt / ShipmentProof | Delivery outcome, failure reason and recorded proof details; binary upload is not implemented |
| TrackingEvent / AuditLog | Customer-safe progress versus internal command/actor evidence |
| CODTransaction / Remittance / Payout | Cash collected for the customer, remitted by the collecting driver and acknowledged by the customer |
| ShippingFeeTransaction | Separate shipping-fee collection and settlement; never merged into COD |
| Notification / NotificationDelivery | Persisted user notification and per-channel delivery intent/recovery state |

Warehouse staff require an active profile for the relevant warehouse. Customer and Driver commands check ownership before success/retry. Admin/Dispatcher privileges are explicit per endpoint; they do not imply every command is available to both roles.

## Shipment commands

The [shipment transition policy](../backend/src/modules/assignments/shipment-transition.policy.ts) defines allowed input states. Services also enforce assignment, route, active transfer, account eligibility and version guards.

| Command | Current-state result |
| --- | --- |
| Customer books | `PENDING` with immutable pricing snapshot |
| Dispatcher confirms | `AWAITING_PICKUP_ASSIGNMENT`; confirmation history includes `CONFIRMED` |
| Assign / driver accept / pickup | `PICKUP_ASSIGNED` → `PICKUP_IN_PROGRESS` → `PICKED_UP` |
| Origin check-in | `AT_ORIGIN_WAREHOUSE` |
| Trip dispatch / destination receipt | `IN_TRANSIT` → `AT_DESTINATION_WAREHOUSE` |
| Ready / assign / start delivery | `AWAITING_DELIVERY_ASSIGNMENT` → `DELIVERY_ASSIGNED` → `OUT_FOR_DELIVERY` |
| Complete / fail attempt | `DELIVERED` or `DELIVERY_FAILED` |
| Redeliver | `DELIVERY_FAILED` → `AWAITING_DELIVERY_ASSIGNMENT` with a new assignment/attempt |
| Request / start / receive return | `RETURN_REQUESTED` → `RETURN_IN_TRANSIT` → `RETURNED` |

Same-warehouse delivery requires the current warehouse to equal the configured destination and no active transfer. Cross-warehouse routing/receipt cannot be skipped. Cancellation is limited by [CancellationPolicy](../backend/src/modules/shipments/cancellation.policy.ts). `DAMAGED` and `LOST` exist in the schema; do not infer a generic status-edit API from enum values.

## Transfer and strict line-haul

Transfers follow `PENDING → IN_TRANSIT → COMPLETED`, with guarded cancellation. A trip follows `PLANNED → READY → IN_TRANSIT → ARRIVED`; eligible PLANNED/READY cancellation preserves its record.

1. Create a pending transfer for a shipment held by the origin warehouse.
2. Admin/Dispatcher creates a matching-route trip with eligible driver/vehicle and manifest.
3. Reserve a valid non-overlapping schedule window and satisfy capacity/eligibility checks before READY.
4. Dispatch the READY trip atomically with its manifest.
5. Destination staff/Admin confirms arrival, then destination staff receives each transfer.

[WarehouseTransferFlowPolicy](../backend/src/modules/warehouses/warehouse-transfer-flow.policy.ts) owns the cutover behavior. An empty `LINE_HAUL_ENFORCEMENT_FROM` means compatibility. Once the stable UTC cutover is reached, new standalone dispatch is rejected. Only transfers actually dispatched before cutover can use grandfathered standalone receipt. Do not move the cutover to bypass a rejection.

## Money and retries

Amounts are integer VND; percentages use basis points. A shipment keeps its quoted price even when Admin publishes a later pricing version. COD follows collection → driver remittance → Admin confirmation/settlement → payout → Customer acknowledgement. Shipping fees are reconciled separately according to sender/receiver payer. Payment providers are disabled by default; recording a cash payout is not an external bank transfer.

Retries retain ownership checks and must not duplicate business history, financial entries or notification intents. Optimistic versions, database transactions, uniqueness/check/exclusion constraints and resource locks protect competing commands. There is no general `PATCH status` route.

## Operational visibility

Control Tower is a read model for Admin/Dispatcher, using one PostgreSQL snapshot, history-derived stage aging and configurable SLA thresholds. [Detailed policy](CONTROL_TOWER_SLA_AGING_20261006.md). Socket notifications prompt refresh; they are not business state. Redis can be rebuilt for supported cache/outbox recovery paths, but reset-token delivery and ephemeral GPS need their own recovery handling. See [backup/restore](BACKUP_RESTORE.md).
