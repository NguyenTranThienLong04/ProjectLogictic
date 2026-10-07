-- Additive delivery recovery; Notification content/read state is unchanged.
CREATE TYPE "NotificationDeliveryChannel" AS ENUM ('REALTIME', 'EMAIL');

CREATE TABLE "NotificationDelivery" (
  "notificationId" UUID NOT NULL,
  "channel" "NotificationDeliveryChannel" NOT NULL,
  "enqueuedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "skippedReason" VARCHAR(50),
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enqueueAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" VARCHAR(500),
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("notificationId", "channel"),
  CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId")
    REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NotificationDelivery_completedAt_nextAttemptAt_idx"
  ON "NotificationDelivery"("completedAt", "nextAttemptAt");

-- Historical realtime cannot be distinguished from a missed emit. Do not replay it.
INSERT INTO "NotificationDelivery" ("notificationId", "channel", "completedAt", "skippedReason")
  SELECT "id", 'REALTIME', CURRENT_TIMESTAMP, 'LEGACY_REALTIME' FROM "Notification";
-- The existing email marker remains authoritative. Unsent email is re-evaluated by the worker.
INSERT INTO "NotificationDelivery" ("notificationId", "channel", "completedAt")
  SELECT "id", 'EMAIL', "emailSentAt" FROM "Notification";
