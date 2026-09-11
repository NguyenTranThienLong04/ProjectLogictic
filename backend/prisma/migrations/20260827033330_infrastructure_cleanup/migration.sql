-- Align the Phase 7 handwritten migration with Prisma's client-side uuid()
-- default. Existing IDs and rows are unchanged.
ALTER TABLE "CODTransaction" ALTER COLUMN "id" DROP DEFAULT;
