# Admin Drivers UX verification — 2026-09-25

## Root cause and scope

The page combined `max-w-6xl` with a 22rem creation panel and a seven-column table without a minimum width or scroll container. DataTable's inherited `wrap-anywhere` allowed character-level wrapping when intrinsic column sizes collapsed. The original table breakpoint also rendered a full table on a 768px tablet. The creation panel lacked a viewport height bound.

This is a presentation/read-query fix. Driver creation/update commands, assignment ownership, GPS, warehouse eligibility, lifecycle and audit policies remain unchanged (C01/C04/C10/C16); regression coverage supports C18.

## Behavior

- The page uses the existing AccountLayout content width. From 768px the creation panel is 18rem, sticky, limited to `100dvh - 3rem` and independently scrollable; below 768px it stays in normal document flow.
- Opt-in DataTable `wide` mode renders cards below 1024px. At desktop it uses a 1160px minimum table width inside a keyboard-focusable horizontal scroll region. Other DataTable consumers retain their existing behavior.
- Columns: Driver, Mã NV, Phương tiện, Năng lực, Kho vận hành, Khả dụng, Thao tác. Name/email/employee code truncate with native title tooltips; capability/status badges and actions do not wrap their text.
- Warehouse cells show name plus smaller code. Create, warehouse filter and edit modal reuse SearchableSelect, matching code/name/city with or without Vietnamese accents. Options show `[CODE] Name — City`; all catalogue pages load. Create/edit only offer active warehouses; filters include inactive warehouses for existing profiles.
- Search by name/email/employee code submits with Enter or Tìm kiếm. Capability, warehouse and status filters apply immediately. Clear filters, result count, empty/error/loading states and server pagination (20/page) reuse existing components.
- Filters and form state are independent. Successful create clears only the completed creation form; updates preserve drafts. Mutations retain filter values and return to page 1 to avoid empty out-of-range pages. A changed row may disappear if it no longer matches the filter.
- BUSY rows disable warehouse editing as before. Stale availability or active assignment conflicts still go through the unchanged backend guard; rejection remains visible in the edit modal and cannot apply a successful UI update.

## API

`GET /drivers` adds optional validated `capability` (DriverCapability enum) and `operatingWarehouseId` (UUID). They combine with existing search/status/date predicates before both count and pagination. Swagger DTO metadata updated. No schema, dependency, migration or mutation contract change.

## Files changed by this task

- `frontend/src/features/operations/admin-drivers-page.tsx`
- `frontend/src/features/operations/operations-api.ts`
- `frontend/src/components/ui/data-table.tsx`
- `backend/src/modules/drivers/dto/list-drivers.dto.ts`
- `backend/src/modules/drivers/drivers.service.ts` (list predicates only)
- `backend/src/modules/drivers/drivers.service.spec.ts`
- `frontend/test/address-location/fixture.tsx` (register real Driver page)
- `frontend/test/address-location/drivers.mjs`
- `PROJECT_STATE.md`
- `docs/ADMIN_DRIVERS_UX.md`

Existing/concurrent Warehouse changes in the workspace are outside this task.

## Verification

| Check | Result |
|---|---|
| Backend Driver service/DTO regression | PASS 8/8 |
| Frontend unit regression | PASS 51/51 |
| Workspace lint and typecheck | PASS |
| Backend + frontend production builds | PASS |
| Browser 1440×900 | PASS |
| Browser 1366×768 | PASS |
| Browser 768×1024 | PASS |
| Browser 375×812 | PASS |
| Create Driver request, refresh and retained filters | PASS |
| Operating warehouse update, retained draft/filters, conflict display | PASS |
| Backend active-assignment rejection without update | PASS |
| Staging | BLOCKED — not deployed; authenticated staging smoke not run |

Reproduce browser checks with `node frontend/test/address-location/drivers.mjs`. Screenshots are generated in ignored `frontend/.vite/drivers-evidence/`. Tests cover desktop min-width/scroll, tablet/mobile cards, no page/list overflow, nonwrapping usable actions, sticky/scrollable panel, search by three fields, combined filters, pagination, no-result/clear, all warehouse catalogue pages (101 fixtures), accent-insensitive warehouse search, create/PATCH payloads and stale backend 409 rejection.

Evidence limits: browser uses production-built real components with intercepted HTTP; backend unit tests use mocked Prisma transactions. This verifies UI contracts and service behavior, not real PostgreSQL persistence or staging. Initial sandbox spawn EPERM was resolved via approved execution; initial test selector ambiguity and lint formatting/matcher issues were corrected. No staging or production mutation was performed.
