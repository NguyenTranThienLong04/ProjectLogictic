# ROADMAP — Chỉ làm phase hiện tại, không nhảy phase

| Phase | Nội dung | Statuses mở khoá | DoD / Note |
|---|---|---|---|
| **0 — Foundation** | React+TS+Vite+Tailwind+`$ui-ux-pro-max`; NestJS+TS; Neon+Prisma; Redis local; Swagger; Validation; Exception handling; Logging; Docker dev; `.env.example` | — | FE boots, BE boots, Neon connected, Prisma migration chạy được, Redis chạy, Swagger chạy |
| **1 — Auth** | User, customer registration, staff accounts, login, JWT access/refresh, logout, forgot/reset password, RBAC, profile | — | Full secure auth flow + tests |
| **2 — Customer & Shipment Core** | Saved Addresses, Pricing Config, Shipping Quote, Create Shipment, Tracking Code, Shipment List/Detail, Cancel, Tracking Timeline | `PENDING, CONFIRMED, CANCELLED, AWAITING_PICKUP_ASSIGNMENT` | backend pricing, ownership, snapshot, tracking, audit |
| **3 — Dispatcher + Pickup Driver** | Driver management/availability, confirm shipment, assign/reassign pickup driver, driver assignments, driver mobile UI, accept/reject, pickup, pickup proof, realtime notification | `PICKUP_ASSIGNED, PICKUP_IN_PROGRESS, PICKED_UP` | |
| **4 — Warehouse Network** | Warehouse CRUD, Warehouse Staff, scan tracking code, inbound/check-in, package verification (weight/dimensions), sorting, WarehouseTransfer (dispatch/transit/receive/outbound) | `AT_ORIGIN_WAREHOUSE, IN_TRANSIT, AT_DESTINATION_WAREHOUSE, AWAITING_DELIVERY_ASSIGNMENT` | |
| **5 — Last-Mile Delivery** | Assign delivery driver, delivery assignment, out for delivery, DeliveryAttempt, POD, delivered, failed delivery, redelivery, return workflow | `DELIVERY_ASSIGNED, OUT_FOR_DELIVERY, DELIVERED, DELIVERY_FAILED, RETURN_REQUESTED, RETURN_IN_TRANSIT, RETURNED` | |
| **6 — Realtime GPS** | Driver location endpoint, Redis current location, socket broadcast, customer tracking map, dispatcher driver map, REAL + SIMULATION provider | — | Demo: driver tab chạy simulation, customer tab thấy marker realtime move |
| **7 — COD** | COD on shipment, driver collection, CODTransaction, admin COD dashboard | `COLLECTED, REMITTED, SETTLED, DISPUTED` | Đảm bảo idempotency |
| **8 — Async + Cache + Notifications** | Redis caching + invalidation, BullMQ email/notification jobs, Notification Center, socket notification, rate limiting | — | Critical job phải retry-safe |
| **9 — Admin Analytics** | Shipment/delivery/driver/warehouse/failed-delivery/COD metrics, charts, filters | — | Dùng DB aggregation, không load hết data về Node |
| **10 — Production Hardening** | Review transaction/concurrency/idempotency/authorization/index/rate-limit/file security/socket authorization/error handling/audit coverage; thêm health check, request ID, structured logging | — | Chạy lint, typecheck, unit, integration, E2E, build |
| **11 — Deployment & Portfolio** | Deploy FE, NestJS, Neon, managed Redis, file storage; CI (install/lint/typecheck/test/build); seed demo data; viết README đầy đủ | — | Seed: 1 Admin, 2 Dispatcher, 3 Warehouse Staff, 5 Driver, 10 Customer, 3 Warehouse, 30+ Shipment |

---

## OPTIONAL ADVANCED (chỉ sau Phase 10 stable)
```
Route distance provider · ETA · Auto driver assignment (rule-based, không cần AI/ML)
Distance-based pricing · Driver workload scoring · Delivery zones
Warehouse capacity · OTP delivery verification · Signature POD
Damage workflow · Lost shipment workflow · Scheduled pickup
Driver route optimization
```

## Operational Realism and final readiness

| Phase | Delivered scope | Status |
|---|---|---|
| A–C | Redis GPS degradation, operating-area/GPS assignment eligibility, owned task-map targets | Completed |
| D–F | Origin warehouse integrity, separate transfer dispatch, immutable fee payer, full browser operational flow | Completed |
| G1–G2 | Driver capabilities, line-haul fleet/trips/manifest and transactional execution | Completed |
| G3A–G3B2 | Scoped line-haul GPS, route metrics/history, deviation and explicit reroute | Completed; production route provider disabled |
| G3C1–G3C3 | Integer weight capacity, half-open scheduling and reviewed planning recommendations | Completed |
| H1–H2 | Independent shipping-fee cash collection and reconciliation | Completed |
| H3 | Provider-neutral online payment contract, test-only adapter and webhook authority | Completed at provider boundary; production payment disabled |
| I1 | Final production readiness audit, regression fixes, full verification and release runbook | Audit only; see [I1 report](PRODUCTION_READINESS_I1.md) for PASS/BLOCKER |

Stop after I1. Production deployment, vendor selection, horizontal scaling and advanced features require a new explicit request; I1 does not authorize deployment.
