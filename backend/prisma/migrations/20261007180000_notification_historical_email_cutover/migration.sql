-- Preserve the already-applied outbox migration. Run the full migration chain with
-- old notification writers/workers stopped, before starting the new backend.
-- LEGACY_REALTIME identifies exactly the notifications backfilled at the outbox
-- schema boundary; notifications created by the new backend do not carry this marker.
-- Historical unsent email is deliberately skipped, never converted into a new send.
UPDATE "NotificationDelivery" AS email
SET "completedAt" = COALESCE(notification."emailSentAt", CURRENT_TIMESTAMP),
    "skippedReason" = CASE WHEN notification."emailSentAt" IS NULL THEN 'LEGACY_EMAIL' ELSE NULL END,
    "lastError" = NULL
FROM "Notification" AS notification
WHERE email."notificationId" = notification."id"
  AND email."channel" = 'EMAIL'
  AND email."completedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "NotificationDelivery" AS realtime
    WHERE realtime."notificationId" = email."notificationId"
      AND realtime."channel" = 'REALTIME'
      AND realtime."skippedReason" = 'LEGACY_REALTIME'
  );
