ALTER TABLE "Notification"
  ADD COLUMN "emailSentAt" TIMESTAMPTZ(3),
  ADD COLUMN "emailMessageId" VARCHAR(200),
  ADD COLUMN "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "emailLastError" VARCHAR(500);

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_emailAttempts_check" CHECK ("emailAttempts" >= 0);
