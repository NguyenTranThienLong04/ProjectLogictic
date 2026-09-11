-- Canonical exception states documented in docs/DOMAIN.md and docs/UI.md.
-- This migration only makes them representable; lifecycle commands remain explicit
-- and are not introduced by this read-model feature.
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'DAMAGED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'LOST';
